export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    // ============================================================
    // CORS
    // ============================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }


    // ============================================================
    // SIMPLE GET TEST
    // ============================================================

    if (request.method !== "POST") {
      return new Response(
        "STAGYLIGHT AI Worker is working!",
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain"
          }
        }
      );
    }


    try {

      const body = await request.json();


      // ============================================================
      // DURABLE OBJECT HEALTH TEST
      //
      // FREE TEST - DOES NOT CALL FAL
      // ============================================================

      if (body.action === "job_test") {

        if (!env.AI_JOB_CONTROLLER) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

        const id = env.AI_JOB_CONTROLLER.idFromName(
          "stagylight-main-ai-controller"
        );

        const controller = env.AI_JOB_CONTROLLER.get(id);

        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/job-test",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "job_test"
              })
            }
          )
        );

        return forwardControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // CREATE AI JOB
      //
      // FREE - DOES NOT CALL FAL
      // ============================================================

      if (body.action === "create_job") {

        if (!env.AI_JOB_CONTROLLER) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

        const jobId = crypto.randomUUID();

        const id = env.AI_JOB_CONTROLLER.idFromName(
          jobId
        );

        const controller = env.AI_JOB_CONTROLLER.get(id);

        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/create-job",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "create_job",
                job_id: jobId
              })
            }
          )
        );

        return forwardControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // GET AI JOB
      //
      // FREE - DOES NOT CALL FAL
      // ============================================================

      if (body.action === "get_job") {

        if (!body.job_id) {
          return jsonResponse(
            {
              ok: false,
              error: "Missing job_id."
            },
            400,
            corsHeaders
          );
        }

        if (!env.AI_JOB_CONTROLLER) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

        const id = env.AI_JOB_CONTROLLER.idFromName(
          body.job_id
        );

        const controller = env.AI_JOB_CONTROLLER.get(id);

        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/get-job",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "get_job",
                job_id: body.job_id
              })
            }
          )
        );

        return forwardControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // START STAGYLIGHT AI JOB
      //
      // HUMAN PHOTO -> STAGE 1 SUBMISSION
      //
      // IMPORTANT:
      // THIS ACTION DOES CALL FAL.AI.
      //
      // Flow:
      //
      // 1. Validate reference image
      // 2. Create unique STAGYLIGHT job ID
      // 3. Save initial job inside Durable Object
      // 4. Submit Stage 1 to fal.ai
      // 5. Save fal request/status/result information
      // 6. Return STAGYLIGHT job state
      //
      // Stage 2 is NOT started in this version.
      // ============================================================

      if (body.action === "start_job") {

        if (!body.image_url) {
          return jsonResponse(
            {
              ok: false,
              error: "No reference image received."
            },
            400,
            corsHeaders
          );
        }

        if (!env.AI_JOB_CONTROLLER) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }


        // ----------------------------------------------------------
        // CREATE UNIQUE STAGYLIGHT JOB
        // ----------------------------------------------------------

        const jobId = crypto.randomUUID();

        const id = env.AI_JOB_CONTROLLER.idFromName(
          jobId
        );

        const controller = env.AI_JOB_CONTROLLER.get(id);


        // ----------------------------------------------------------
        // SAVE INITIAL JOB STATE
        // ----------------------------------------------------------

        const createResponse = await controller.fetch(
          new Request(
            "https://stagylight.internal/create-job",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "create_job",
                job_id: jobId,
                reference_image: body.image_url
              })
            }
          )
        );

        if (!createResponse.ok) {

          const createError = await createResponse.text();

          return new Response(
            createError,
            {
              status: createResponse.status,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }


        // ----------------------------------------------------------
        // BUILD STAGE 1 REQUEST
        // ----------------------------------------------------------

        const falBody = buildStage1FalBody(
          body.image_url
        );


        // ----------------------------------------------------------
        // SUBMIT STAGE 1 TO FAL
        //
        // THIS IS THE POINT WHERE AN AI GENERATION IS SUBMITTED.
        // ----------------------------------------------------------

        const falResponse = await fetch(
          "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
          {
            method: "POST",
            headers: {
              "Authorization": `Key ${env.FAL_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(falBody)
          }
        );


        const falText = await falResponse.text();


        // ----------------------------------------------------------
        // HANDLE FAL SUBMISSION FAILURE
        // ----------------------------------------------------------

        if (!falResponse.ok) {

          await controller.fetch(
            new Request(
              "https://stagylight.internal/update-job",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  action: "stage_1_error",
                  error:
                    "Stage 1 submission failed: " +
                    falText
                })
              }
            )
          );

          return jsonResponse(
            {
              ok: false,
              job_id: jobId,
              error: "Stage 1 submission failed.",
              fal_response: safeParseJson(falText)
            },
            falResponse.status,
            corsHeaders
          );
        }


        // ----------------------------------------------------------
        // PARSE FAL QUEUE RESPONSE
        // ----------------------------------------------------------

        const falData = safeParseJson(
          falText
        );


        const requestId =
          falData &&
          falData.request_id
            ? falData.request_id
            : null;


        const statusUrl =
          falData &&
          falData.status_url
            ? falData.status_url
            : null;


        const responseUrl =
          falData &&
          falData.response_url
            ? falData.response_url
            : null;


        const cancelUrl =
          falData &&
          falData.cancel_url
            ? falData.cancel_url
            : null;


        // ----------------------------------------------------------
        // SAVE STAGE 1 QUEUE INFORMATION
        // ----------------------------------------------------------

        const updateResponse = await controller.fetch(
          new Request(
            "https://stagylight.internal/update-job",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "stage_1_submitted",

                fal_request_id: requestId,

                fal_status_url: statusUrl,

                fal_response_url: responseUrl,

                fal_cancel_url: cancelUrl
              })
            }
          )
        );


        const updateText =
          await updateResponse.text();


        if (!updateResponse.ok) {

          return new Response(
            updateText,
            {
              status: updateResponse.status,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }


        const updatedJob =
          safeParseJson(updateText);


        // ----------------------------------------------------------
        // RETURN STAGYLIGHT JOB
        // ----------------------------------------------------------

        return jsonResponse(
          {
            ok: true,

            message:
              "STAGYLIGHT AI job started",

            job_id: jobId,

            stage:
              "stage_1",

            status:
              "processing",

            job:
              updatedJob &&
              updatedJob.job
                ? updatedJob.job
                : updatedJob
          },
          200,
          corsHeaders
        );
      }


      // ============================================================
      // EXISTING STATUS / RESULT PROXY
      //
      // KEEP CURRENT ANDROID POLLING WORKING
      // ============================================================

      if (body.action === "status" && body.url) {

        const statusResponse = await fetch(
          body.url,
          {
            headers: {
              "Authorization": `Key ${env.FAL_KEY}`
            }
          }
        );

        const statusData =
          await statusResponse.text();

        return new Response(
          statusData,
          {
            status:
              statusResponse.status,

            headers: {
              ...corsHeaders,

              "Content-Type":
                statusResponse.headers.get(
                  "Content-Type"
                ) ||
                "application/json"
            }
          }
        );
      }


      // ============================================================
      // EXISTING DIRECT STAGE 1 GENERATION
      //
      // KEEP CURRENT ANDROID APP WORKING.
      //
      // If Android sends image_url WITHOUT action=start_job,
      // this existing route continues behaving as before.
      // ============================================================

      if (!body.image_url) {

        return jsonResponse(
          {
            error:
              "No reference image received."
          },
          400,
          corsHeaders
        );
      }


      const falBody =
        buildStage1FalBody(
          body.image_url
        );


      const response = await fetch(
        "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Key ${env.FAL_KEY}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              falBody
            )
        }
      );


      const data =
        await response.text();


      return new Response(
        data,
        {
          status:
            response.status,

          headers: {
            ...corsHeaders,

            "Content-Type":
              response.headers.get(
                "Content-Type"
              ) ||
              "application/json"
          }
        }
      );


    } catch (error) {

      return jsonResponse(
        {
          ok: false,
          error: error.message
        },
        500,
        corsHeaders
      );
    }
  }
};


// ================================================================
// STAGE 1 FAL BODY
// ================================================================

function buildStage1FalBody(
  imageUrl
) {

  const identityPrompt = `

Create ONE premium illustrated portrait of the EXACT SAME PERSON
shown in the supplied reference photograph.

This is STAGYLIGHT IDENTITY MASTER — STAGE 1.

THIS IS NOT THE FINAL Q-VERSION.

Do NOT create a chibi character yet.
Do NOT create a baby-like character.
Do NOT substantially change the person's facial proportions.

============================================================
HIGHEST PRIORITY: PRESERVE THE PERSON'S IDENTITY
============================================================

The finished portrait must be immediately recognizable as the
same real adult person shown in the supplied photograph.

Treat the supplied photograph as the authoritative identity reference.

Preserve the person's distinctive natural facial geometry.

Carefully preserve:

- overall face shape
- forehead proportions
- cheek structure
- cheek width
- jawline
- chin shape
- eyebrow shape
- eyebrow position
- natural eye shape
- natural eye size
- eye spacing
- eyelid appearance
- nose shape
- nose width
- nose proportions
- mouth shape
- lip proportions
- natural facial balance
- skin tone
- visible distinctive facial characteristics

Do NOT replace these features with generic anime features.

Do NOT replace them with generic cartoon features.

Do NOT beautify the person into a different-looking individual.

The result should look like:

"THIS EXACT REAL PERSON AS A PREMIUM DIGITAL ILLUSTRATION."

It should NOT look like:

"a new fictional character inspired by this person."

============================================================
ADULT APPEARANCE
============================================================

Preserve the apparent adult age and mature facial proportions
shown in the reference photograph.

The illustrated person must still clearly look like an adult.

DO NOT make the person look like:

- a baby
- a toddler
- a young child
- a childlike chibi
- a baby-faced doll

Do not make the cheeks excessively round.

Do not shorten the lower face excessively.

Do not remove the natural jawline.

Do not make the chin tiny.

Do not make the nose unusually small.

============================================================
EYES
============================================================

Keep the person's natural eye shape recognizable.

Do NOT dramatically enlarge the eyes.

Do NOT create huge round anime eyes.

Do NOT create doll-like eyes.

Do NOT change the natural spacing between the eyes.

Preserve the relationship between the eyes, eyebrows,
nose and mouth.

============================================================
HAIR
============================================================

Preserve the hairstyle shown in the reference photograph.

Preserve:

- haircut
- hairline
- hair length
- fringe
- swept direction
- side shape
- top volume
- texture
- visible colour distribution
- dark/light areas

Do NOT redesign the hairstyle.

Do NOT replace it with a different fashionable hairstyle.

If the original photograph slightly crops the highest part of
the hairstyle, naturally reconstruct the expected continuation
of the SAME hairstyle.

Do NOT reproduce the accidental crop.

============================================================
CLOTHING AND ACCESSORIES
============================================================

Preserve the clothing type and main colours visible in the
reference photograph.

Preserve clearly visible accessories when appropriate.

Do not invent a completely different outfit.

Do not add unrelated accessories.

============================================================
NATURAL PRESENTATION
============================================================

Preserve the person's visible gender presentation exactly as
shown in the reference photograph.

Preserve the person's natural skin tone.

Do NOT add cosmetic styling that is not clearly present in the
reference photograph.

Do NOT add:

- lipstick
- eyeliner
- eyeshadow
- prominent artificial eyelashes
- heavy cosmetic blush
- beauty makeup

Natural subtle skin colour variation is acceptable.

Do not create pink cosmetic cheeks.

============================================================
EXPRESSION
============================================================

Preserve the person's natural personality and facial character.

Use a natural, pleasant expression suitable for a premium
profile avatar.

A subtle friendly expression is acceptable.

Do not dramatically alter the mouth shape.

Do not create an exaggerated cartoon expression.

============================================================
CRITICAL COMPOSITION RULE
============================================================

NOTHING IMPORTANT MAY BE CROPPED.

ZOOM OUT WHEN NECESSARY.

The entire hairstyle MUST be visible.

The highest point of the hair MUST be completely inside
the square canvas.

Leave approximately 10 to 15 percent clean background space
ABOVE the highest point of the hairstyle.

Leave comfortable background space on BOTH sides of the head
and hairstyle.

Keep the following comfortably inside the canvas:

- complete hairstyle
- complete top of head
- both sides of the hair
- ears where naturally visible
- complete face
- chin
- neck
- shoulders
- upper chest

Nothing important should touch the edge of the image.

Do NOT crop:

- hair
- top of head
- sides of hairstyle
- ears
- chin
- shoulders

Frame approximately from the upper chest upward.

Make the person smaller within the canvas if necessary.

CENTER the person horizontally.

The final composition must feel spacious and intentionally
framed rather than tightly zoomed.

============================================================
ILLUSTRATION STYLE
============================================================

Transform the photograph into a polished premium digital
illustration.

Use:

- clean smooth digital rendering
- refined facial detail
- natural facial proportions
- subtle attractive illustration stylization
- professional avatar quality
- soft controlled shading
- clean edges
- premium modern character artwork

The style may have a gentle anime-inspired finish,
but REAL-PERSON IDENTITY must remain substantially stronger
than anime stylization.

This is an IDENTITY MASTER.

It should be only mildly stylized.

Do NOT apply Q-character proportions yet.

Do NOT enlarge the head substantially.

Do NOT shrink the body substantially.

Do NOT make the person look like a toy.

Do NOT make the person look like a doll.

Do NOT make the person look like a baby.

============================================================
BACKGROUND
============================================================

Use a simple clean neutral background.

The background should not distract from the person.

Do not add text.

Do not add a watermark.

Do not add logos that were not present in the original image.

Do not add another person.

Do not create multiple versions.

Do not create a collage.

Do not create a character sheet.

============================================================
FINAL PRIORITY ORDER
============================================================

1. SAME PERSON / FACIAL IDENTITY
2. ADULT APPEARANCE
3. SAME HAIRSTYLE
4. COMPLETE HEAD AND HAIR INSIDE FRAME
5. SAME CLOTHING / ACCESSORIES
6. NATURAL PRESENTATION
7. PREMIUM ILLUSTRATION QUALITY

When there is any conflict between making the portrait more
stylized and preserving identity, ALWAYS choose preserving
identity.

Generate exactly ONE centered square illustrated adult portrait.

`;


  return {

    prompt:
      identityPrompt,

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
  };
}


// ================================================================
// GENERAL JSON RESPONSE HELPER
// ================================================================

function jsonResponse(
  data,
  status,
  corsHeaders
) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json"
      }
    }
  );
}


// ================================================================
// SAFE JSON PARSER
// ================================================================

function safeParseJson(text) {

  try {
    return JSON.parse(text);
  } catch (error) {
    return {
      raw: text
    };
  }
}


// ================================================================
// FORWARD DURABLE OBJECT RESPONSE
// ================================================================

async function forwardControllerResponse(
  response,
  corsHeaders
) {

  const text =
    await response.text();

  return new Response(
    text,
    {
      status:
        response.status,

      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json"
      }
    }
  );
}


// ================================================================
// STAGYLIGHT AI JOB CONTROLLER
//
// One Durable Object instance per STAGYLIGHT job.
//
// CURRENT CAPABILITIES:
//
// job_test
// create_job
// get_job
// stage_1_submitted
// stage_1_error
//
// NEXT:
//
// check Stage 1
// capture Stage 1 image
// submit Stage 2
// capture final Q Master
// ================================================================

export class AIJobController {

  constructor(ctx, env) {

    this.ctx =
      ctx;

    this.env =
      env;
  }


  async fetch(request) {

    try {

      const body =
        await request.json();


      // ============================================================
      // HEALTH TEST
      // ============================================================

      if (
        body.action ===
        "job_test"
      ) {

        return controllerJson({
          ok: true,

          controller:
            "AIJobController",

          message:
            "STAGYLIGHT AI Job Controller is ready",

          fal_called:
            false
        });
      }


      // ============================================================
      // CREATE JOB
      // ============================================================

      if (
        body.action ===
        "create_job"
      ) {

        if (!body.job_id) {

          return controllerJson(
            {
              ok: false,
              error:
                "Missing job_id."
            },
            400
          );
        }


        const now =
          new Date().toISOString();


        const job = {

          job_id:
            body.job_id,

          status:
            "created",

          stage:
            "waiting",

          reference_image:
            body.reference_image ||
            null,

          stage_1_status:
            "not_started",

          stage_1_request_id:
            null,

          stage_1_status_url:
            null,

          stage_1_response_url:
            null,

          stage_1_cancel_url:
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

          stage_2_cancel_url:
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

          job:
            job
        });
      }


      // ============================================================
      // GET JOB
      // ============================================================

      if (
        body.action ===
        "get_job"
      ) {

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
          job: job
        });
      }


      // ============================================================
      // STAGE 1 SUBMITTED
      // ============================================================

      if (
        body.action ===
        "stage_1_submitted"
      ) {

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


        job.status =
          "processing";

        job.stage =
          "stage_1";

        job.stage_1_status =
          "submitted";

        job.stage_1_request_id =
          body.fal_request_id ||
          null;

        job.stage_1_status_url =
          body.fal_status_url ||
          null;

        job.stage_1_response_url =
          body.fal_response_url ||
          null;

        job.stage_1_cancel_url =
          body.fal_cancel_url ||
          null;

        job.fal_called =
          true;

        job.error =
          null;

        job.updated_at =
          new Date().toISOString();


        await this.ctx.storage.put(
          "job",
          job
        );


        return controllerJson({
          ok: true,

          message:
            "Stage 1 submitted",

          job:
            job
        });
      }


      // ============================================================
      // STAGE 1 ERROR
      // ============================================================

      if (
        body.action ===
        "stage_1_error"
      ) {

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


        job.status =
          "error";

        job.stage =
          "stage_1";

        job.stage_1_status =
          "error";

        job.error =
          body.error ||
          "Unknown Stage 1 error.";

        job.updated_at =
          new Date().toISOString();


        await this.ctx.storage.put(
          "job",
          job
        );


        return controllerJson({
          ok: true,

          message:
            "Stage 1 error recorded",

          job:
            job
        });
      }


      // ============================================================
      // UNKNOWN ACTION
      // ============================================================

      return controllerJson(
        {
          ok: false,
          error:
            "Unknown controller action."
        },
        400
      );


    } catch (error) {

      return controllerJson(
        {
          ok: false,
          error:
            error.message
        },
        500
      );
    }
  }
}


// ================================================================
// DURABLE OBJECT JSON HELPER
// ================================================================

function controllerJson(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}
