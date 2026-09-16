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
      // Q-STICKER GENERATION
      // Saved Master Q -> Sticker
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

        if (stickerType !== "haha") {
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
          getHahaStickerPrompt()
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

            message:
              "Haha Q-Sticker submitted.",

            request_id:
              result.data.request_id || null,

            status_url:
              result.data.status_url || null,

            response_url:
              result.data.response_url || null
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

        const jobId =
          crypto.randomUUID();

        return forward(
          await controller(
            env,
            jobId
          ).fetch(
            internalRequest(
              "create_job",
              {
                job_id: jobId,
                image_url:
                  body.image_url || null
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
      //
      // Used by Android for both Create My Q and stickers.
      // =========================================================

      if (
        body.action === "status" &&
        body.url
      ) {

        const r = await fetch(
          body.url,
          {
            headers: {
              "Authorization":
                `Key ${env.FAL_KEY}`
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
                r.headers.get(
                  "Content-Type"
                ) ||
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
            error:
              "No reference image received."
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
            "Content-Type":
              "application/json"
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

      const body =
        await request.json();


      // =========================================================
      // TEST
      // =========================================================

      if (body.action === "job_test") {

        return controllerJson({
          ok: true,

          controller:
            "AIJobController",

          message:
            "STAGYLIGHT two-stage AI controller ready",

          fal_called:
            false
        });
      }


      // =========================================================
      // CREATE JOB
      // =========================================================

      if (body.action === "create_job") {

        const now =
          new Date().toISOString();

        const job = {

          job_id:
            body.job_id,

          status:
            "created",

          stage:
            "waiting",

          source_image:
            body.image_url || null,

          stage_1_status:
            "not_started",

          stage_1_request_id:
            null,

          stage_1_status_url:
            null,

          stage_1_response_url:
            null,

          stage_1_image:
            null,

          stage_2_status:
            "not_started",

          stage_2_request_id:
            null,

          stage_2_status_url:
            null,

          stage_2_response_url:
            null,

          stage_2_image:
            null,

          final_image:
            null,

          error:
            null,

          created_at:
            now,

          updated_at:
            now,

          fal_called:
            false
        };

        await this.ctx.storage.put(
          "job",
          job
        );

        return controllerJson({
          ok: true,

          message:
            "STAGYLIGHT AI job created",

          job
        });
      }


      // =========================================================
      // GET JOB
      // =========================================================

      if (body.action === "get_job") {

        const job =
          await this.ctx.storage.get(
            "job"
          );

        if (!job) {

          return controllerJson(
            {
              ok: false,
              error:
                "Job not found."
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
          await this.ctx.storage.get(
            "job"
          );

        if (!job) {

          return controllerJson(
            {
              ok: false,
              error:
                "Job not found."
            },
            404
          );
        }

        if (!body.image_url) {

          return controllerJson(
            {
              ok: false,
              error:
                "Missing image_url."
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

            message:
              "Stage 1 already started.",

            job
          });
        }


        job.source_image =
          body.image_url;

        job.status =
          "processing";

        job.stage =
          "stage_1";

        job.stage_1_status =
          "submitting";

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

          job.status =
            "error";

          job.stage_1_status =
            "error";

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


        job.stage_1_status =
          "submitted";

        job.stage_1_request_id =
          result.data.request_id ||
          null;

        job.stage_1_status_url =
          result.data.status_url ||
          null;

        job.stage_1_response_url =
          result.data.response_url ||
          null;

        job.fal_called =
          true;

        await saveJob(
          this.ctx,
          job
        );


        return controllerJson({
          ok: true,

          message:
            "Stage 1 submitted.",

          job
        });
      }


      // =========================================================
      // ADVANCE JOB
      // =========================================================

      if (
        body.action ===
        "advance_job"
      ) {

        let job =
          await this.ctx.storage.get(
            "job"
          );

        if (!job) {

          return controllerJson(
            {
              ok: false,
              error:
                "Job not found."
            },
            404
          );
        }


        if (
          job.status ===
          "completed"
        ) {

          return controllerJson({
            ok: true,

            message:
              "Q Master is ready.",

            job
          });
        }


        if (
          job.status ===
          "error"
        ) {

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
          job.stage_1_status ===
            "submitted" ||
          job.stage_1_status ===
            "processing"
        ) {

          const check =
            await checkFal(
              job.stage_1_status_url,
              job.stage_1_response_url,
              this.env.FAL_KEY
            );


          if (
            check.state ===
            "processing"
          ) {

            job.stage_1_status =
              "processing";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson({
              ok: true,

              message:
                "Stage 1 is processing.",

              job
            });
          }


          if (
            check.state ===
            "error"
          ) {

            job.status =
              "error";

            job.stage_1_status =
              "error";

            job.error =
              check.error;

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  check.error,
                job
              },
              500
            );
          }


          const stage1Image =
            extractImage(
              check.data
            );


          if (!stage1Image) {

            job.status =
              "error";

            job.stage_1_status =
              "error";

            job.error =
              "Stage 1 completed but no image was returned.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  job.error,
                job
              },
              500
            );
          }


          job.stage_1_status =
            "completed";

          job.stage_1_image =
            stage1Image;

          job.stage =
            "stage_2";

          await saveJob(
            this.ctx,
            job
          );
        }


        // =======================================================
        // SUBMIT STAGE 2
        // =======================================================

        if (
          job.stage_1_status ===
            "completed" &&
          job.stage_2_status ===
            "not_started"
        ) {

          job.stage_2_status =
            "submitting";

          job.stage =
            "stage_2";

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

            job.status =
              "error";

            job.stage_2_status =
              "error";

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
                error:
                  job.error,
                job
              },
              500
            );
          }


          job.stage_2_status =
            "submitted";

          job.stage_2_request_id =
            result.data.request_id ||
            null;

          job.stage_2_status_url =
            result.data.status_url ||
            null;

          job.stage_2_response_url =
            result.data.response_url ||
            null;

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
          job.stage_2_status ===
            "submitted" ||
          job.stage_2_status ===
            "processing"
        ) {

          const check =
            await checkFal(
              job.stage_2_status_url,
              job.stage_2_response_url,
              this.env.FAL_KEY
            );


          if (
            check.state ===
            "processing"
          ) {

            job.stage_2_status =
              "processing";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson({
              ok: true,

              message:
                "Stage 2 is processing.",

              job
            });
          }


          if (
            check.state ===
            "error"
          ) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              check.error;

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  check.error,
                job
              },
              500
            );
          }


          const finalImage =
            extractImage(
              check.data
            );


          if (!finalImage) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              "Stage 2 completed but no image was returned.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  job.error,
                job
              },
              500
            );
          }


          job.stage_2_status =
            "completed";

          job.stage_2_image =
            finalImage;

          job.final_image =
            finalImage;

          job.status =
            "completed";

          job.stage =
            "completed";

          job.error =
            null;

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

          message:
            "Job is waiting.",

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

        input_fidelity:
          "high",

        image_size:
          "1024x1024",

        quality:
          "high",

        background:
          "opaque",

        num_images:
          1,

        output_format:
          "png",

        sync_mode:
          false
      })
    }
  );


  const text =
    await r.text();

  let data =
    null;

  try {
    data =
      JSON.parse(text);
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


  const text =
    await r.text();

  let data;

  try {
    data =
      JSON.parse(text);
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


  if (
    status !== "COMPLETED"
  ) {

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
      JSON.parse(
        resultText
      );
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

============================================================
FACE — ALMOST NO GEOMETRIC CHANGE
============================================================

Keep the face extremely close to the supplied Identity Master.

Preserve:

- exact face length-to-width ratio
- forehead height and width
- cheek width
- cheekbone position
- jawline and jaw angle
- chin length, width and shape
- eyebrow shape, thickness and position
- exact natural eye shape
- exact eye opening
- eye size
- iris size relative to the eye
- eye spacing
- eyelids
- eyebrow-to-eye distance
- nose bridge
- nose length
- nose tip
- nostril width
- mouth width
- mouth shape
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

DO NOT smooth away distinctive facial features.

The FACE itself should receive MINIMAL Q distortion.

============================================================
EYES — STRICT LOCK
============================================================

DO NOT enlarge the eyes.

DO NOT widen the eyes.

DO NOT make the eyes rounder.

DO NOT create anime eyes, doll eyes or childlike eyes.

Keep the same natural eye shape, size, eyelid opening,
iris proportion and spacing as the Identity Master.

Expression may change slightly without changing eye anatomy.

============================================================
ADULT — STRICT LOCK
============================================================

The character MUST clearly remain an adult.

NO baby face.
NO toddler appearance.
NO child appearance.
NO baby-faced chibi.
NO inflated cheeks.
NO tiny nose.
NO tiny chin.
NO extremely round head.
NO youthful doll face.

Do not make the person appear substantially younger.

============================================================
Q STYLE
============================================================

Create the Q-character feeling primarily through:

- polished cute illustration rendering
- slightly larger head relative to the body
- moderately compact shoulders and upper body
- clean Q-avatar silhouette
- friendly expression
- premium sticker-like presentation

Do NOT enlarge individual facial features to create cuteness.

Do NOT substantially change facial geometry.

The head-to-body relationship may change,
but the FACE INSIDE THE HEAD stays recognizable and mature.

Use only mild Q proportions.

Avoid extreme super-deformed chibi proportions.

============================================================
HAIR
============================================================

Preserve the SAME hairstyle:

- hairline
- haircut
- fringe
- swept direction
- top volume
- side shape
- texture
- length
- colour distribution
- dark/light areas

Do NOT redesign the hair.

If necessary, reconstruct the natural continuation of the
same hairstyle so the complete hair is visible.

============================================================
CLOTHING AND ACCESSORIES
============================================================

Preserve the same clothing, main colours and visible accessories
from the Identity Master.

Do NOT redesign the outfit.

============================================================
NO MAKEUP
============================================================

Do NOT add:

- cosmetic blush
- pink cheeks
- lipstick
- eyeliner
- eyeshadow
- artificial eyelashes
- beauty makeup

Cuteness must NOT come from cosmetics.

============================================================
EXPRESSION
============================================================

Use a pleasant, friendly and confident adult expression.

A small natural smile is suitable.

Keep the person's recognizable mouth structure.

============================================================
STYLE
============================================================

Premium modern STAGYLIGHT Q illustration.

Cute but mature.
Identity-first.
Clean digital artwork.
Refined facial detail.
Smooth controlled shading.
Professional avatar/sticker quality.

The FACE should be more structurally realistic than a normal
chibi character.

The BODY may be more Q-stylized than the face.

Do NOT make the final image photorealistic.
Do NOT make it generic anime.
Do NOT make it childish.

============================================================
COMPOSITION
============================================================

Show:

- entire hairstyle
- full head
- complete face
- chin
- neck
- shoulders
- upper body

Leave approximately 10 to 15 percent clean background above
the highest point of the hairstyle.

Nothing important may touch or leave the canvas.

Zoom out when necessary.

Center the character on a simple clean neutral background.

No text.
No watermark.
No logo.
No extra person.
No collage.
No multiple versions.

============================================================
FINAL PRIORITY
============================================================

1. SAME FACE AS THE IDENTITY MASTER
2. SAME RECOGNIZABLE ADULT PERSON
3. NATURAL ORIGINAL EYES
4. ORIGINAL FACE LENGTH / JAW / CHIN
5. ORIGINAL NOSE AND MOUTH
6. SAME HAIRSTYLE
7. MILD Q HEAD-TO-BODY PROPORTIONS
8. SAME CLOTHING / ACCESSORIES
9. NO MAKEUP OR BLUSH
10. PREMIUM STAGYLIGHT QUALITY

IF CUTENESS CONFLICTS WITH IDENTITY:

IDENTITY MUST WIN.

DO NOT CREATE A NEW CHIBI FACE.

KEEP THE EXISTING FACE AND Q-STYLIZE THE CHARACTER AROUND IT.

Generate exactly ONE square Adult Q Master.

`;
}


// ===============================================================
// HAHA Q-STICKER PROMPT
// MASTER Q -> SAME CHARACTER LAUGHING
// ===============================================================

function getHahaStickerPrompt() {

  return `

Create ONE "HAHA" reaction Q-Sticker using the EXACT SAME
STAGYLIGHT Q CHARACTER shown in the supplied Master Q image.

THIS IMAGE IS THE CHARACTER MASTER.

DO NOT create a new character.

DO NOT redesign the person's face.

DO NOT change their identity.

The finished sticker must immediately look like the EXACT SAME
Q CHARACTER.

============================================================
CHARACTER IDENTITY LOCK
============================================================

Preserve:

- same recognizable face
- same face shape
- same adult appearance
- same eye identity
- same eyebrows
- same nose
- same mouth structure
- same jaw and chin
- same skin tone
- same hairstyle
- same hair colour distribution
- same clothing
- same visible accessories
- same overall Q art style

Do NOT turn the character into a different anime or chibi person.

Do NOT make the character younger.

Do NOT make the face rounder or more baby-like.

============================================================
HAHA REACTION
============================================================

Change mainly the EXPRESSION and POSE.

Create a clearly happy laughing reaction.

The character should look genuinely amused and joyful.

Use:

- cheerful laughing expression
- natural smiling/laughing mouth
- slightly raised happy cheeks
- lively but recognizable eyes
- playful positive energy
- optional mild upper-body laughing gesture

The expression should clearly communicate:

HAHA 😂

But the person's identity must remain recognizable.

Do NOT make the eyes huge.

Do NOT replace the eyes with generic anime shapes.

Do NOT distort the mouth beyond recognition.

Do NOT create an extreme screaming expression.

============================================================
CHARACTER CONSISTENCY
============================================================

This sticker belongs to an existing STAGYLIGHT Q character set.

It must look like the SAME character as the supplied Master Q.

Do NOT change:

- hairstyle
- hair colour
- outfit
- accessories
- skin tone
- facial identity
- Q illustration style

Only expression and a small suitable pose change are allowed.

============================================================
NO UNWANTED MAKEUP
============================================================

Do NOT add:

- cosmetic blush
- pink cosmetic cheeks
- lipstick
- eyeliner
- eyeshadow
- artificial eyelashes
- beauty makeup

============================================================
COMPOSITION
============================================================

Show the complete hairstyle and head.

Do not crop the top of the hair.

Keep the face, chin, neck, shoulders and enough upper body
visible for the reaction.

Leave comfortable clean space around the character.

Center the character.

Use a simple clean neutral background.

============================================================
STYLE
============================================================

Match the supplied Master Q's existing illustration style.

Premium polished digital Q artwork.

Clean edges.

Smooth controlled shading.

Cute but clearly adult.

Professional reaction-sticker quality.

No text.

No words.

No watermark.

No logo.

No additional people.

No collage.

No multiple versions.

============================================================
FINAL PRIORITY
============================================================

1. EXACT SAME MASTER Q CHARACTER
2. SAME RECOGNIZABLE FACE
3. SAME HAIR
4. SAME CLOTHING
5. CLEAR HAPPY LAUGHING REACTION
6. ADULT APPEARANCE
7. SAME ART STYLE
8. NO UNWANTED MAKEUP
9. COMPLETE HAIR INSIDE FRAME

Generate exactly ONE square Haha Q-Sticker.

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
    "https://stagylight.internal/" +
    action,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
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
    Array.isArray(
      data.images
    ) &&
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
      status:
        response.status,

      headers: {
        ...cors,

        "Content-Type":
          "application/json"
      }
    }
  );
}
