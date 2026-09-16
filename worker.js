export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return new Response(
        "STAGYLIGHT AI Worker is working!",
        {
          headers: {
            ...cors,
            "Content-Type": "text/plain"
          }
        }
      );
    }

    try {

      const body = await request.json();


      // =========================================================
      // BASIC Q-STICKER GENERATION
      // =========================================================

      if (body.action === "create_sticker") {

        if (!body.image_url) {
          return json(
            {
              ok: false,
              error: "Missing Master Q image."
            },
            400,
            cors
          );
        }

        const stickerType =
          String(body.sticker_type || "").toLowerCase();

        const supportedStickers = [
          "hi",
          "haha",
          "love",
          "thankyou",
          "sad",
          "goodnight"
        ];

        if (!supportedStickers.includes(stickerType)) {
          return json(
            {
              ok: false,
              error: "Unsupported sticker type."
            },
            400,
            cors
          );
        }

        const result = await submitFal(
          env.FAL_KEY,
          body.image_url,
          getStickerPrompt(stickerType)
        );

        if (!result.ok || !result.data) {
          return json(
            {
              ok: false,
              error: "Sticker generation submission failed.",
              details: result.text
            },
            500,
            cors
          );
        }

        return json(
          {
            ok: true,
            message: "Q-Sticker submitted.",
            sticker_type: stickerType,
            request_id: result.data.request_id || null,
            status_url: result.data.status_url || null,
            response_url: result.data.response_url || null
          },
          200,
          cors
        );
      }


      // =========================================================
      // DURABLE OBJECT TEST
      // =========================================================

      if (body.action === "job_test") {

        return forward(
          await controller(
            env,
            "stagylight-main-ai-controller"
          ).fetch(
            internalRequest(
              "job_test",
              body
            )
          ),
          cors
        );
      }


      // =========================================================
      // CREATE TWO-STAGE Q JOB
      // =========================================================

      if (body.action === "create_job") {

        const jobId = crypto.randomUUID();

        return forward(
          await controller(
            env,
            jobId
          ).fetch(
            internalRequest(
              "create_job",
              {
                job_id: jobId,
                image_url: body.image_url || null
              }
            )
          ),
          cors
        );
      }


      // =========================================================
      // START / ADVANCE / GET JOB
      // =========================================================

      if (
        body.action === "start_job" ||
        body.action === "advance_job" ||
        body.action === "get_job"
      ) {

        if (!body.job_id) {
          return json(
            {
              ok: false,
              error: "Missing job_id."
            },
            400,
            cors
          );
        }

        if (
          body.action === "start_job" &&
          !body.image_url
        ) {
          return json(
            {
              ok: false,
              error: "Missing image_url."
            },
            400,
            cors
          );
        }

        return forward(
          await controller(
            env,
            body.job_id
          ).fetch(
            internalRequest(
              body.action,
              body
            )
          ),
          cors
        );
      }


      // =========================================================
      // FAL STATUS / RESULT PROXY
      // =========================================================

      if (
        body.action === "status" &&
        body.url
      ) {

        const r = await fetch(
          body.url,
          {
            headers: {
              "Authorization": `Key ${env.FAL_KEY}`
            }
          }
        );

        return new Response(
          await r.text(),
          {
            status: r.status,
            headers: {
              ...cors,
              "Content-Type":
                r.headers.get("Content-Type") ||
                "application/json"
            }
          }
        );
      }


      // =========================================================
      // LEGACY SINGLE-STAGE ROUTE
      // =========================================================

      if (!body.image_url) {

        return json(
          {
            ok: false,
            error: "No reference image received."
          },
          400,
          cors
        );
      }

      const r = await submitFal(
        env.FAL_KEY,
        body.image_url,
        getIdentityPrompt()
      );

      return new Response(
        r.text,
        {
          status: r.status,
          headers: {
            ...cors,
            "Content-Type": "application/json"
          }
        }
      );

    } catch (e) {

      return json(
        {
          ok: false,
          error: e.message
        },
        500,
        cors
      );
    }
  }
};


// ===============================================================
// DURABLE OBJECT
// ===============================================================

export class AIJobController {

  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {

    try {

      const body = await request.json();


      // =========================================================
      // TEST
      // =========================================================

      if (body.action === "job_test") {

        return controllerJson({
          ok: true,
          controller: "AIJobController",
          message: "STAGYLIGHT two-stage AI controller ready",
          fal_called: false
        });
      }


      // =========================================================
      // CREATE JOB
      // =========================================================

      if (body.action === "create_job") {

        const now = new Date().toISOString();

        const job = {

          job_id: body.job_id,

          status: "created",

          stage: "waiting",

          source_image: body.image_url || null,

          stage_1_status: "not_started",
          stage_1_request_id: null,
          stage_1_status_url: null,
          stage_1_response_url: null,
          stage_1_image: null,

          stage_2_status: "not_started",
          stage_2_request_id: null,
          stage_2_status_url: null,
          stage_2_response_url: null,
          stage_2_image: null,

          final_image: null,

          error: null,

          created_at: now,
          updated_at: now,

          fal_called: false
        };

        await this.ctx.storage.put(
          "job",
          job
        );

        return controllerJson({
          ok: true,
          message: "STAGYLIGHT AI job created",
          job
        });
      }


      // =========================================================
      // GET JOB
      // =========================================================

      if (body.action === "get_job") {

        const job =
          await this.ctx.storage.get("job");

        if (!job) {
          return controllerJson(
            {
              ok: false,
              error: "Job not found."
            },
            404
          );
        }

        return controllerJson({
          ok: true,
          job
        });
      }


      // =========================================================
      // START STAGE 1
      // =========================================================

      if (body.action === "start_job") {

        let job =
          await this.ctx.storage.get("job");

        if (!job) {
          return controllerJson(
            {
              ok: false,
              error: "Job not found."
            },
            404
          );
        }

        if (!body.image_url) {
          return controllerJson(
            {
              ok: false,
              error: "Missing image_url."
            },
            400
          );
        }


        // Prevent duplicate paid generation.

        if (
          job.stage_1_status !==
          "not_started"
        ) {

          return controllerJson({
            ok: true,
            message: "Stage 1 already started.",
            job
          });
        }


        job.source_image = body.image_url;
        job.status = "processing";
        job.stage = "stage_1";
        job.stage_1_status = "submitting";

        await saveJob(
          this.ctx,
          job
        );


        const result =
          await submitFal(
            this.env.FAL_KEY,
            body.image_url,
            getIdentityPrompt()
          );


        if (
          !result.ok ||
          !result.data
        ) {

          job.status = "error";
          job.stage_1_status = "error";

          job.error =
            result.text ||
            "Stage 1 submission failed.";

          await saveJob(
            this.ctx,
            job
          );

          return controllerJson(
            {
              ok: false,
              error: job.error,
              job
            },
            500
          );
        }


        job.stage_1_status = "submitted";

        job.stage_1_request_id =
          result.data.request_id || null;

        job.stage_1_status_url =
          result.data.status_url || null;

        job.stage_1_response_url =
          result.data.response_url || null;

        job.fal_called = true;

        await saveJob(
          this.ctx,
          job
        );


        return controllerJson({
          ok: true,
          message: "Stage 1 submitted.",
          job
        });
      }


      // =========================================================
      // ADVANCE JOB
      // =========================================================

      if (body.action === "advance_job") {

        let job =
          await this.ctx.storage.get("job");

        if (!job) {
          return controllerJson(
            {
              ok: false,
              error: "Job not found."
            },
            404
          );
        }


        if (job.status === "completed") {

          return controllerJson({
            ok: true,
            message: "Q Master is ready.",
            job
          });
        }


        if (job.status === "error") {

          return controllerJson(
            {
              ok: false,
              error:
                job.error ||
                "AI job failed.",
              job
            },
            500
          );
        }


        // =======================================================
        // CHECK STAGE 1
        // =======================================================

        if (
          job.stage_1_status === "submitted" ||
          job.stage_1_status === "processing"
        ) {

          const check =
            await checkFal(
              job.stage_1_status_url,
              job.stage_1_response_url,
              this.env.FAL_KEY
            );


          if (check.state === "processing") {

            job.stage_1_status = "processing";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson({
              ok: true,
              message: "Stage 1 is processing.",
              job
            });
          }


          if (check.state === "error") {

            job.status = "error";
            job.stage_1_status = "error";
            job.error = check.error;

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error: check.error,
                job
              },
              500
            );
          }


          const stage1Image =
            extractImage(check.data);


          if (!stage1Image) {

            job.status = "error";
            job.stage_1_status = "error";

            job.error =
              "Stage 1 completed but no image was returned.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error: job.error,
                job
              },
              500
            );
          }


          job.stage_1_status = "completed";
          job.stage_1_image = stage1Image;
          job.stage = "stage_2";

          await saveJob(
            this.ctx,
            job
          );
        }


        // =======================================================
        // SUBMIT STAGE 2
        // =======================================================

        if (
          job.stage_1_status === "completed" &&
          job.stage_2_status === "not_started"
        ) {

          job.stage_2_status = "submitting";
          job.stage = "stage_2";

          await saveJob(
            this.ctx,
            job
          );


          const result =
            await submitFal(
              this.env.FAL_KEY,
              job.stage_1_image,
              getQMasterPrompt()
            );


          if (
            !result.ok ||
            !result.data
          ) {

            job.status = "error";
            job.stage_2_status = "error";

            job.error =
              result.text ||
              "Stage 2 submission failed.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error: job.error,
                job
              },
              500
            );
          }


          job.stage_2_status = "submitted";

          job.stage_2_request_id =
            result.data.request_id || null;

          job.stage_2_status_url =
            result.data.status_url || null;

          job.stage_2_response_url =
            result.data.response_url || null;

          await saveJob(
            this.ctx,
            job
          );


          return controllerJson({
            ok: true,
            message:
              "Stage 1 complete. Stage 2 submitted.",
            job
          });
        }


        // =======================================================
        // CHECK STAGE 2
        // =======================================================

        if (
          job.stage_2_status === "submitted" ||
          job.stage_2_status === "processing"
        ) {

          const check =
            await checkFal(
              job.stage_2_status_url,
              job.stage_2_response_url,
              this.env.FAL_KEY
            );


          if (check.state === "processing") {

            job.stage_2_status = "processing";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson({
              ok: true,
              message: "Stage 2 is processing.",
              job
            });
          }


          if (check.state === "error") {

            job.status = "error";
            job.stage_2_status = "error";
            job.error = check.error;

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error: check.error,
                job
              },
              500
            );
          }


          const finalImage =
            extractImage(check.data);


          if (!finalImage) {

            job.status = "error";
            job.stage_2_status = "error";

            job.error =
              "Stage 2 completed but no image was returned.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error: job.error,
                job
              },
              500
            );
          }


          job.stage_2_status = "completed";
          job.stage_2_image = finalImage;
          job.final_image = finalImage;

          job.status = "completed";
          job.stage = "completed";
          job.error = null;

          await saveJob(
            this.ctx,
            job
          );


          return controllerJson({
            ok: true,
            message:
              "STAGYLIGHT Q Master completed.",
            job
          });
        }


        return controllerJson({
          ok: true,
          message: "Job is waiting.",
          job
        });
      }


      return controllerJson(
        {
          ok: false,
          error:
            "Unknown controller action."
        },
        400
      );

    } catch (e) {

      return controllerJson(
        {
          ok: false,
          error: e.message
        },
        500
      );
    }
  }
}


// ===============================================================
// FAL SUBMIT
// ===============================================================

async function submitFal(
  falKey,
  imageUrl,
  prompt
) {

  const r = await fetch(
    "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
    {
      method: "POST",

      headers: {
        "Authorization":
          `Key ${falKey}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({

        prompt,

        image_urls: [
          imageUrl
        ],

        input_fidelity: "high",

        image_size: "1024x1024",

        quality: "high",

        background: "opaque",

        num_images: 1,

        output_format: "png",

        sync_mode: false
      })
    }
  );


  const text = await r.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch (_) {}


  return {
    ok: r.ok,
    status: r.status,
    text,
    data
  };
}


// ===============================================================
// FAL STATUS + RESULT
// ===============================================================

async function checkFal(
  statusUrl,
  responseUrl,
  falKey
) {

  if (!statusUrl) {

    return {
      state: "error",
      error:
        "Missing fal.ai status URL."
    };
  }


  const r =
    await fetch(
      statusUrl,
      {
        headers: {
          "Authorization":
            `Key ${falKey}`
        }
      }
    );


  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (_) {

    return {
      state: "error",
      error:
        "Invalid fal.ai status response."
    };
  }


  if (!r.ok) {

    return {
      state: "error",
      error:
        data?.detail ||
        data?.error ||
        text
    };
  }


  const status =
    String(
      data.status || ""
    ).toUpperCase();


  if (
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS"
  ) {

    return {
      state: "processing"
    };
  }


  if (status !== "COMPLETED") {

    return {
      state: "processing"
    };
  }


  if (!responseUrl) {

    return {
      state: "error",
      error:
        "fal.ai completed but response URL is missing."
    };
  }


  const result =
    await fetch(
      responseUrl,
      {
        headers: {
          "Authorization":
            `Key ${falKey}`
        }
      }
    );


  const resultText =
    await result.text();

  let resultData;

  try {

    resultData =
      JSON.parse(resultText);

  } catch (_) {

    return {
      state: "error",
      error:
        "Invalid fal.ai result response."
    };
  }


  if (!result.ok) {

    return {
      state: "error",
      error:
        resultData?.detail ||
        resultData?.error ||
        resultText
    };
  }


  return {
    state: "completed",
    data: resultData
  };
}


// ===============================================================
// STAGE 1
// HUMAN PHOTO -> IDENTITY MASTER
// ===============================================================

function getIdentityPrompt() {

  return `

Create ONE premium illustrated portrait of the EXACT SAME ADULT
PERSON shown in the supplied reference photograph.

This is STAGYLIGHT IDENTITY MASTER — STAGE 1.

This is NOT the final Q character.

IDENTITY IS THE HIGHEST PRIORITY.

The result must immediately look like the SAME PERSON.

Preserve the person's actual:

- face length and width
- forehead
- cheek structure
- jawline
- chin
- eyebrow shape
- natural eye shape and size
- eye spacing
- eyelids
- nose shape, width and length
- mouth shape
- lip proportions
- skin tone
- distinctive facial characteristics
- adult age appearance
- visible gender presentation

Do NOT substitute generic anime or cartoon facial features.

Do NOT beautify the person into somebody else.

Preserve the hairstyle extremely carefully:

- haircut
- hairline
- length
- fringe
- direction
- side shape
- top volume
- texture
- colour distribution

If the source crops the very highest part of the hair,
naturally reconstruct the continuation of the SAME hairstyle.

Preserve visible clothing and accessories.

Do NOT add makeup, lipstick, eyeliner, eyeshadow,
artificial eyelashes, blush or pink cheeks unless clearly
present in the source.

Keep mature adult facial proportions.

NO baby face.
NO child appearance.
NO huge anime eyes.
NO excessively round cheeks.
NO tiny nose.
NO tiny chin.

Create a polished premium digital illustration with mild
stylization only.

COMPOSITION:

Show the complete hairstyle, head, face, chin, neck,
shoulders and upper chest.

Leave approximately 10 to 15 percent clean background above
the highest point of the hairstyle.

Nothing important may touch or leave the canvas.

Center the person on a clean neutral background.

If illustration style conflicts with recognizable identity,
PRESERVE IDENTITY.

Generate exactly ONE square portrait.

`;
}


// ===============================================================
// STAGE 2
// IDENTITY MASTER -> ADULT Q MASTER
// ===============================================================

function getQMasterPrompt() {

  return `

Transform the supplied STAGYLIGHT IDENTITY MASTER into ONE
premium ADULT Q CHARACTER of the EXACT SAME PERSON.

ABSOLUTE PRIORITY:

PRESERVE THE FACE.

The supplied Identity Master already contains the correct face.

DO NOT redesign, reinterpret, beautify, simplify or reconstruct
the face into a typical chibi or anime face.

The final character must be unmistakably the SAME ADULT PERSON.

FACE — ALMOST NO GEOMETRIC CHANGE:

Preserve:

- exact face length-to-width ratio
- forehead height and width
- cheek width and placement
- jawline and jaw angle
- chin length, width and shape
- eyebrow shape, thickness and position
- exact natural eye shape
- exact eye opening and size
- iris size relative to eye
- eye spacing
- eyelids
- eyebrow-to-eye distance
- nose bridge, length and tip
- nostril width
- mouth width and shape
- cupid's bow
- lip thickness
- nose-to-mouth distance
- lower-face length
- skin tone
- distinctive facial characteristics
- adult age appearance
- visible gender presentation

DO NOT round or widen the face.

DO NOT shorten the lower face.

DO NOT enlarge the forehead.

DO NOT shrink the nose or chin.

The FACE itself should receive MINIMAL Q distortion.

EYES — STRICT LOCK:

DO NOT enlarge, widen or round the eyes.

DO NOT create anime, doll or childlike eyes.

Keep the same natural eye anatomy.

ADULT — STRICT LOCK:

NO baby face.
NO toddler.
NO child.
NO baby-faced chibi.
NO inflated cheeks.
NO tiny nose.
NO tiny chin.
NO extremely round head.
NO youthful doll face.

Q STYLE:

Create the Q feeling mainly through:

- polished cute illustration rendering
- slightly larger head relative to body
- moderately compact shoulders and upper body
- clean Q-avatar silhouette
- friendly expression
- premium sticker presentation

Do NOT enlarge facial features to create cuteness.

The face stays recognizable and mature.

Use mild Q proportions only.

HAIR:

Preserve the SAME hairstyle, hairline, haircut, fringe,
direction, top volume, side shape, texture, length and
colour distribution.

CLOTHING AND ACCESSORIES:

Preserve the same clothing, colours and visible accessories.

NO MAKEUP:

Do NOT add cosmetic blush, pink cheeks, lipstick,
eyeliner, eyeshadow, artificial eyelashes or beauty makeup.

EXPRESSION:

Pleasant, friendly and confident adult expression.

Use a small natural smile.

STYLE:

Premium modern STAGYLIGHT Q illustration.

Cute but mature.
Identity-first.
Clean digital artwork.
Refined facial detail.
Smooth controlled shading.
Professional avatar/sticker quality.

The FACE should remain more structurally realistic than
a normal chibi character.

COMPOSITION:

Show entire hairstyle, full head, complete face, chin,
neck, shoulders and upper body.

Leave approximately 10 to 15 percent clean background
above the hairstyle.

Center on a clean neutral background.

No text.
No watermark.
No logo.
No extra person.
No collage.
No multiple versions.

FINAL PRIORITY:

1. SAME FACE
2. SAME ADULT PERSON
3. NATURAL ORIGINAL EYES
4. ORIGINAL FACE LENGTH / JAW / CHIN
5. ORIGINAL NOSE AND MOUTH
6. SAME HAIRSTYLE
7. MILD Q PROPORTIONS
8. SAME CLOTHING / ACCESSORIES
9. NO MAKEUP OR BLUSH
10. PREMIUM STAGYLIGHT QUALITY

IF CUTENESS CONFLICTS WITH IDENTITY:

IDENTITY MUST WIN.

KEEP THE EXISTING FACE AND Q-STYLIZE THE CHARACTER AROUND IT.

Generate exactly ONE square Adult Q Master.

`;
}


// ===============================================================
// BASIC Q-STICKER PROMPTS
// ===============================================================

function getStickerPrompt(type) {

  const reactions = {

    hi: `
HI / GREETING REACTION 👋

Create a warm, friendly greeting.

The character is smiling naturally and raising ONE hand
in a clear friendly waving gesture.

Expression:
pleasant, welcoming, confident and cheerful.

Do not exaggerate the smile or eyes.

The result should clearly communicate "Hi!" without using text.
`,

    haha: `
HAHA / LAUGHING REACTION 😂

Create a genuinely joyful laughing expression.

Use a natural open smile or laugh, happy eyes and a playful
upper-body reaction.

The character should look strongly amused and cheerful.

Do not create huge anime eyes or distort the mouth beyond
recognition.

The result should clearly communicate laughter without text.
`,

    love: `
LOVE / AFFECTION REACTION ❤️

Create a sweet, warm and affectionate reaction.

Use a gentle happy smile.

The character may form a small heart gesture using the hands
or hold both hands naturally near the chest.

The expression should communicate affection and appreciation.

Keep it mature and natural.

Do NOT add romantic makeup, blush or exaggerated pink cheeks.

The result should clearly communicate love without text.
`,

    thankyou: `
THANK YOU / GRATITUDE REACTION 🙏

Create a sincere grateful expression.

Use a warm natural smile.

Place the hands together respectfully in front of the chest
in a clear gratitude / thank-you gesture.

Keep the pose friendly, natural and mature.

The result should clearly communicate gratitude without text.
`,

    sad: `
SAD / UPSET REACTION 😢

Create a clearly sad and emotionally disappointed expression.

The mouth may turn slightly downward.

The eyes should look naturally sad and emotional.

A small natural tear is allowed.

Do NOT enlarge the eyes.
Do NOT create giant cartoon tears.
Do NOT turn the face into a different character.

Keep the sadness believable, gentle and recognizable.

The result should clearly communicate sadness without text.
`,

    goodnight: `
GOOD NIGHT / SLEEPY REACTION 🌙

Create a peaceful, sleepy good-night reaction.

Use relaxed or gently closed eyes and a calm soft expression.

The character may rest the side of the face naturally against
joined hands in a sleeping gesture.

Keep the same hairstyle and clothing clearly recognizable.

Do NOT add nightwear or redesign the outfit.

The result should clearly communicate good night / sleep
without text.
`
  };


  const reaction =
    reactions[type] ||
    reactions.haha;


  return `

Create exactly ONE premium STAGYLIGHT Q reaction sticker using
the supplied MASTER Q image.

THE SUPPLIED IMAGE IS THE CHARACTER MASTER.

ABSOLUTE RULE:

KEEP THE EXACT SAME CHARACTER.

DO NOT invent a new Q character.
DO NOT redesign the face.
DO NOT reinterpret the person's identity.
DO NOT change the character's age.

============================================================
IDENTITY LOCK
============================================================

The underlying facial structure must remain the SAME even when
the emotion changes the facial muscles.

Preserve:

- same recognizable face
- same face length-to-width ratio
- same forehead
- same cheek structure
- same jawline
- same chin
- same eyebrows
- same eye placement
- same natural eye anatomy
- same nose shape and size
- same mouth identity
- same lower-face proportions
- same skin tone
- same adult appearance
- same distinctive facial characteristics

EMOTION MAY CHANGE FACIAL MUSCLES.

EMOTION MUST NOT CHANGE FACIAL IDENTITY.

Do NOT make the face wider or rounder.

Do NOT shorten the face.

Do NOT shrink the nose.

Do NOT shrink the chin.

Do NOT make the person younger.

============================================================
HAIR LOCK
============================================================

Preserve exactly the same:

- hairstyle
- hairline
- fringe
- swept direction
- top volume
- side shape
- length
- texture
- hair colour distribution

Do NOT redesign the hairstyle.

============================================================
CLOTHING + ACCESSORY LOCK
============================================================

Keep exactly the same main clothing and visible accessories
as the supplied Master Q.

Do NOT redesign the outfit merely to match the reaction.

============================================================
Q STYLE LOCK
============================================================

Match the supplied Master Q's existing illustration style.

Maintain:

- same Q-character design language
- same level of facial realism
- same adult Q proportions
- same rendering quality
- same smooth controlled shading
- same premium STAGYLIGHT visual identity

Do NOT convert the character into a generic anime,
manga or baby chibi character.

============================================================
REACTION
============================================================

${reaction}

============================================================
STRICT EYE RULE
============================================================

Expression may naturally change the eyelids.

However:

DO NOT make the eyes larger than the Master Q.
DO NOT make them rounder to create cuteness.
DO NOT replace them with generic anime eyes.
DO NOT create doll eyes.

============================================================
ADULT LOCK
============================================================

The character must clearly remain the same adult.

NO baby face.
NO toddler proportions.
NO child appearance.
NO inflated cheeks.
NO tiny nose.
NO tiny chin.
NO youthful doll face.

============================================================
NO MAKEUP
============================================================

Do NOT add:

- cosmetic blush
- artificial pink cheeks
- lipstick
- eyeliner
- eyeshadow
- artificial eyelashes
- beauty makeup

============================================================
COMPOSITION
============================================================

Show the entire hairstyle and head.

Do NOT crop the top of the hair.

Show enough neck, shoulders, arms and upper body to clearly
display the reaction gesture when needed.

Keep all important hands and gestures inside the frame.

Center the character.

Use a clean simple neutral background suitable for a reaction
sticker.

No written text.
No letters.
No watermark.
No logo.
No extra people.
No collage.
No multiple versions.

============================================================
FINAL PRIORITY
============================================================

1. EXACT SAME MASTER Q CHARACTER
2. SAME FACE AND FACIAL STRUCTURE
3. SAME ADULT IDENTITY
4. SAME HAIRSTYLE
5. SAME CLOTHING AND ACCESSORIES
6. CORRECT REACTION / POSE
7. SAME Q ART STYLE
8. NATURAL FACIAL EXPRESSION
9. NO UNWANTED MAKEUP
10. PREMIUM STAGYLIGHT QUALITY

IF EMOTION CONFLICTS WITH IDENTITY:

IDENTITY MUST WIN.

CHANGE THE EMOTION, NOT THE PERSON.

Generate exactly ONE square reaction Q-Sticker.

`;
}


// ===============================================================
// HELPERS
// ===============================================================

function controller(
  env,
  name
) {

  if (!env.AI_JOB_CONTROLLER) {

    throw new Error(
      "AI_JOB_CONTROLLER binding is unavailable."
    );
  }

  const id =
    env.AI_JOB_CONTROLLER.idFromName(
      name
    );

  return env.AI_JOB_CONTROLLER.get(
    id
  );
}


function internalRequest(
  action,
  data
) {

  return new Request(
    "https://stagylight.internal/" + action,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        ...data,
        action
      })
    }
  );
}


async function saveJob(
  ctx,
  job
) {

  job.updated_at =
    new Date().toISOString();

  await ctx.storage.put(
    "job",
    job
  );
}


function extractImage(data) {

  if (
    data &&
    Array.isArray(data.images) &&
    data.images.length > 0 &&
    data.images[0]?.url
  ) {

    return data.images[0].url;
  }

  return null;
}


function json(
  data,
  status,
  cors
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...cors,
        "Content-Type":
          "application/json"
      }
    }
  );
}


function controllerJson(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}


async function forward(
  response,
  cors
) {

  return new Response(
    await response.text(),
    {
      status: response.status,

      headers: {
        ...cors,
        "Content-Type":
          "application/json"
      }
    }
  );
}
