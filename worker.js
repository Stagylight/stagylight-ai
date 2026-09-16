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
      return new Response("STAGYLIGHT AI Worker is working!", {
        headers: { ...cors, "Content-Type": "text/plain" }
      });
    }

    try {
      const body = await request.json();

      // =========================================================
      // DURABLE OBJECT ROUTES
      // =========================================================

      if (body.action === "job_test") {
        return forward(
          await controller(env, "stagylight-main-ai-controller").fetch(
            internalRequest("job_test", body)
          ),
          cors
        );
      }

      if (body.action === "create_job") {
        const jobId = crypto.randomUUID();

        return forward(
          await controller(env, jobId).fetch(
            internalRequest("create_job", {
              job_id: jobId,
              image_url: body.image_url || null
            })
          ),
          cors
        );
      }

      if (
        body.action === "start_job" ||
        body.action === "advance_job" ||
        body.action === "get_job"
      ) {
        if (!body.job_id) {
          return json(
            { ok: false, error: "Missing job_id." },
            400,
            cors
          );
        }

        if (
          body.action === "start_job" &&
          !body.image_url
        ) {
          return json(
            { ok: false, error: "Missing image_url." },
            400,
            cors
          );
        }

        return forward(
          await controller(env, body.job_id).fetch(
            internalRequest(body.action, body)
          ),
          cors
        );
      }

      // =========================================================
      // LEGACY STATUS / RESULT PROXY
      // =========================================================

      if (body.action === "status" && body.url) {
        const r = await fetch(body.url, {
          headers: {
            "Authorization": `Key ${env.FAL_KEY}`
          }
        });

        return new Response(await r.text(), {
          status: r.status,
          headers: {
            ...cors,
            "Content-Type":
              r.headers.get("Content-Type") ||
              "application/json"
          }
        });
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

      return new Response(r.text, {
        status: r.status,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      });

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

        await this.ctx.storage.put("job", job);

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

        // Prevent duplicate paid calls.
        if (job.stage_1_status !== "not_started") {
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
        job.updated_at = new Date().toISOString();

        await this.ctx.storage.put("job", job);

        const result = await submitFal(
          this.env.FAL_KEY,
          body.image_url,
          getIdentityPrompt()
        );

        if (!result.ok || !result.data) {
          job.status = "error";
          job.stage_1_status = "error";
          job.error =
            result.text ||
            "Stage 1 submission failed.";

          await saveJob(this.ctx, job);

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

        await saveJob(this.ctx, job);

        return controllerJson({
          ok: true,
          message: "Stage 1 submitted.",
          job
        });
      }

      // =========================================================
      // ADVANCE TWO-STAGE JOB
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
                job.error || "AI job failed.",
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
          const check = await checkFal(
            job.stage_1_status_url,
            job.stage_1_response_url,
            this.env.FAL_KEY
          );

          if (check.state === "processing") {
            job.stage_1_status = "processing";
            await saveJob(this.ctx, job);

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

            await saveJob(this.ctx, job);

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

            await saveJob(this.ctx, job);

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

          await saveJob(this.ctx, job);
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

          await saveJob(this.ctx, job);

          const result = await submitFal(
            this.env.FAL_KEY,
            job.stage_1_image,
            getQMasterPrompt()
          );

          if (!result.ok || !result.data) {
            job.status = "error";
            job.stage_2_status = "error";
            job.error =
              result.text ||
              "Stage 2 submission failed.";

            await saveJob(this.ctx, job);

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

          await saveJob(this.ctx, job);

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
          const check = await checkFal(
            job.stage_2_status_url,
            job.stage_2_response_url,
            this.env.FAL_KEY
          );

          if (check.state === "processing") {
            job.stage_2_status = "processing";

            await saveJob(this.ctx, job);

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

            await saveJob(this.ctx, job);

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

            await saveJob(this.ctx, job);

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

          await saveJob(this.ctx, job);

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
          error: "Unknown controller action."
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
        "Authorization": `Key ${falKey}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        prompt,
        image_urls: [imageUrl],

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
      error: "Missing fal.ai status URL."
    };
  }

  const r = await fetch(statusUrl, {
    headers: {
      "Authorization": `Key ${falKey}`
    }
  });

  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (_) {
    return {
      state: "error",
      error: "Invalid fal.ai status response."
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
    String(data.status || "").toUpperCase();

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

  const result = await fetch(responseUrl, {
    headers: {
      "Authorization": `Key ${falKey}`
    }
  });

  const resultText = await result.text();

  let resultData;

  try {
    resultData = JSON.parse(resultText);
  } catch (_) {
    return {
      state: "error",
      error: "Invalid fal.ai result response."
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
// STAGE 1 — HUMAN PHOTO -> IDENTITY MASTER
// KEEP REAL IDENTITY STRONG
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
// STAGE 2 — IDENTITY MASTER -> FINAL Q MASTER
//
// NEW VERSION:
// FACE = VERY LIGHT STYLIZATION
// Q EFFECT = MAINLY HEAD/BODY + ART STYLE
// ===============================================================

function getQMasterPrompt() {
  return `
Create ONE premium STAGYLIGHT ADULT Q CHARACTER by transforming
the SUPPLIED IDENTITY MASTER ITSELF.

CRITICAL RULE:

THIS IS THE SAME PERSON.

Do NOT invent a new face.
Do NOT reinterpret the person's identity.
Do NOT replace the face with a generic chibi/anime face.

The supplied Identity Master already contains the correct facial
identity. Treat its face as LOCKED REFERENCE GEOMETRY.

TARGET:

Approximately 90 percent recognizable personal identity.
Approximately 10 percent facial Q stylization.

Most of the cute Q feeling must come from:

- slightly larger head-to-body ratio
- smaller upper body
- polished illustration rendering
- friendly expression
- clean avatar/sticker presentation

NOT from changing the person's face.

============================================================
FACE GEOMETRY LOCK — HIGHEST PRIORITY
============================================================

Keep extremely close to the supplied Identity Master:

- exact overall face shape
- face length
- face width
- forehead height
- cheek width
- cheekbone placement
- jaw width
- jaw angle
- chin length and shape
- eyebrow shape and position
- eye shape
- eye size
- eye spacing
- eyelid structure
- nose bridge
- nose length
- nose width
- nostril proportions
- mouth width
- mouth shape
- lip proportions
- distance between nose and mouth
- lower-face length
- natural facial asymmetry where visible
- skin tone
- adult age appearance
- visible gender presentation

The viewer should recognize the SAME PERSON from the face alone.

DO NOT simplify the face into standard chibi geometry.

============================================================
EYES — DO NOT ANIME-ENLARGE
============================================================

Keep the eyes close to their ORIGINAL size and shape.

Only a VERY SMALL increase in expressiveness is allowed.

Do NOT create:

- giant round eyes
- oversized anime eyes
- doll eyes
- sparkling childlike eyes
- heavily widened eyes
- thick cosmetic eyelashes

Natural recognizable eye identity is more important than cuteness.

============================================================
NO BABY-FACE TRANSFORMATION
============================================================

The character MUST remain clearly ADULT.

Do NOT:

- shorten the face dramatically
- inflate the cheeks
- make the jaw extremely round
- shrink the nose
- shrink the chin
- enlarge the forehead excessively
- make toddler proportions
- create a baby-faced chibi
- create a doll face

Keep the person's mature lower-face structure.

============================================================
Q PROPORTIONS
============================================================

Create controlled Q proportions WITHOUT rebuilding the face.

The head may be approximately 15 to 20 percent larger relative
to the upper body.

Reduce the upper-body proportion moderately.

Do NOT make the head enormous.

Do NOT use extreme super-deformed chibi proportions.

The result should feel like a premium adult Q avatar,
not a children's cartoon character.

============================================================
HAIR — IDENTITY LOCK
============================================================

Preserve the hairstyle from the Identity Master.

Keep:

- hairline
- haircut
- fringe
- swept direction
- top volume
- side shape
- texture
- hair length
- light/dark colour distribution

Do NOT replace the hairstyle with generic cartoon hair.

The complete hairstyle must remain inside the image.

============================================================
CLOTHING + ACCESSORIES
============================================================

Keep the same recognizable clothing and visible accessories
from the Identity Master.

Do NOT redesign the outfit.

============================================================
NO UNWANTED COSMETICS
============================================================

Do NOT add:

- blush
- pink cheeks
- lipstick
- eyeliner
- eyeshadow
- beauty makeup
- prominent artificial eyelashes

Cute appearance must come from expression, proportions and
illustration quality — NEVER cosmetic feminization.

============================================================
EXPRESSION
============================================================

Use a pleasant, confident, friendly ADULT expression.

A mild natural smile is suitable.

Keep the person's recognizable mouth shape.

Do NOT create an exaggerated open-mouth cartoon expression.

============================================================
ART STYLE
============================================================

Use premium polished digital Q-character artwork.

Clean edges.
Smooth controlled shading.
Refined facial detail.
Professional avatar/sticker quality.

The face should retain MORE realistic structural detail than
a normal chibi character.

Do NOT make it photorealistic.

Do NOT make it generic anime.

Do NOT make it childish.

============================================================
COMPOSITION
============================================================

Show completely:

- full hairstyle
- highest point of hair
- full head
- face
- chin
- neck
- shoulders
- upper body

Leave approximately 10 to 15 percent clean background above
the highest point of the hair.

Nothing important may touch the canvas edge.

Zoom out if necessary.

Use a clean neutral background.

No text.
No watermark.
No logo.
No additional people.
No collage.
No multiple versions.

============================================================
FINAL PRIORITY
============================================================

1. SAME RECOGNIZABLE FACE
2. SAME ADULT PERSON
3. ORIGINAL EYE / NOSE / MOUTH / JAW GEOMETRY
4. SAME HAIRSTYLE
5. CONTROLLED ADULT Q PROPORTIONS
6. SAME CLOTHING AND ACCESSORIES
7. NO BLUSH OR UNWANTED MAKEUP
8. FULL HAIR INSIDE FRAME
9. PREMIUM STAGYLIGHT QUALITY

If Q stylization conflicts with facial identity,
FACIAL IDENTITY MUST WIN.

Do not invent a Q character.

Stylize the supplied Identity Master itself.

Generate exactly ONE square Adult Q Master.
`;
}


// ===============================================================
// HELPERS
// ===============================================================

function controller(env, name) {
  if (!env.AI_JOB_CONTROLLER) {
    throw new Error(
      "AI_JOB_CONTROLLER binding is unavailable."
    );
  }

  const id =
    env.AI_JOB_CONTROLLER.idFromName(name);

  return env.AI_JOB_CONTROLLER.get(id);
}


function internalRequest(action, data) {
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


async function saveJob(ctx, job) {
  job.updated_at =
    new Date().toISOString();

  await ctx.storage.put("job", job);
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


function json(data, status, cors) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...cors,
        "Content-Type": "application/json"
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
        "Content-Type": "application/json"
      }
    }
  );
}


async function forward(response, cors) {
  return new Response(
    await response.text(),
    {
      status: response.status,
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    }
  );
}
