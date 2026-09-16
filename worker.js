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
    // HEALTH CHECK
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
      // ============================================================

      if (body.action === "job_test") {

        const controller = getController(
          env,
          "stagylight-main-ai-controller"
        );

        if (!controller) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

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
      // CREATE TWO-STAGE AI JOB
      //
      // This creates the job only.
      // No fal.ai generation happens here.
      // ============================================================

      if (body.action === "create_job") {

        const jobId = crypto.randomUUID();

        const controller = getController(
          env,
          jobId
        );

        if (!controller) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

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
                job_id: jobId,
                image_url: body.image_url || null
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
      // START TWO-STAGE AI JOB
      //
      // Requires:
      // {
      //   "action": "start_job",
      //   "job_id": "...",
      //   "image_url": "..."
      // }
      //
      // This WILL submit Stage 1 to fal.ai.
      // ============================================================

      if (body.action === "start_job") {

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

        if (!body.image_url) {
          return jsonResponse(
            {
              ok: false,
              error: "Missing image_url."
            },
            400,
            corsHeaders
          );
        }

        const controller = getController(
          env,
          body.job_id
        );

        if (!controller) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/start-job",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "start_job",
                job_id: body.job_id,
                image_url: body.image_url
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
      // ADVANCE TWO-STAGE AI JOB
      //
      // Android / client polls this action.
      //
      // The controller will:
      //
      // Stage 1 submitted
      // -> check Stage 1
      // -> collect Identity Master
      // -> submit Stage 2
      // -> check Stage 2
      // -> collect final Q Master
      //
      // One call performs only the work needed for the current state.
      // ============================================================

      if (body.action === "advance_job") {

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

        const controller = getController(
          env,
          body.job_id
        );

        if (!controller) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/advance-job",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "advance_job",
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
      // GET JOB
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

        const controller = getController(
          env,
          body.job_id
        );

        if (!controller) {
          return jsonResponse(
            {
              ok: false,
              error: "AI_JOB_CONTROLLER binding is unavailable."
            },
            500,
            corsHeaders
          );
        }

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
      // EXISTING ANDROID STATUS / RESULT PROXY
      //
      // KEEP OLD ANDROID FLOW WORKING.
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
            status: statusResponse.status,
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
      // LEGACY STAGE-1 GENERATION
      //
      // IMPORTANT:
      // The existing Android app can continue sending image_url
      // without an action.
      //
      // This preserves the old working behaviour.
      // ============================================================

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

      const legacyFalBody = {
        prompt: getIdentityPrompt(),

        image_urls: [
          body.image_url
        ],

        input_fidelity: "high",

        image_size: "1024x1024",

        quality: "high",

        background: "opaque",

        num_images: 1,

        output_format: "png",

        sync_mode: false
      };

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

          body: JSON.stringify(
            legacyFalBody
          )
        }
      );

      const data =
        await response.text();

      return new Response(
        data,
        {
          status: response.status,

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
// MAIN WORKER HELPERS
// ================================================================

function getController(
  env,
  name
) {

  if (!env.AI_JOB_CONTROLLER) {
    return null;
  }

  const id =
    env.AI_JOB_CONTROLLER.idFromName(
      name
    );

  return env.AI_JOB_CONTROLLER.get(
    id
  );
}


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


async function forwardControllerResponse(
  response,
  corsHeaders
) {

  const text =
    await response.text();

  return new Response(
    text,
    {
      status: response.status,

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
// Each job_id receives its own Durable Object.
//
// STATE MACHINE:
//
// created
//
// -> stage_1_submitted
//
// -> stage_1_processing
//
// -> stage_1_complete
//
// -> stage_2_submitted
//
// -> stage_2_processing
//
// -> completed
//
// OR
//
// -> error
// ================================================================

export class AIJobController {

  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }


  async fetch(request) {

    try {

      const body =
        await request.json();

      // ============================================================
      // HEALTH TEST
      // ============================================================

      if (body.action === "job_test") {

        return controllerJson({
          ok: true,

          controller:
            "AIJobController",

          message:
            "STAGYLIGHT two-stage AI Job Controller is ready",

          fal_called: false
        });
      }

      // ============================================================
      // CREATE JOB
      // ============================================================

      if (body.action === "create_job") {

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

          job: job
        });
      }

      // ============================================================
      // GET JOB
      // ============================================================

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
          job: job
        });
      }

      // ============================================================
      // START JOB
      //
      // Submit Stage 1.
      // ============================================================

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

        // Prevent duplicate paid submission.

        if (
          job.stage_1_status !==
          "not_started"
        ) {

          return controllerJson({
            ok: true,

            message:
              "Stage 1 already started.",

            job: job
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

        job.updated_at =
          new Date().toISOString();

        await this.ctx.storage.put(
          "job",
          job
        );

        const falBody = {

          prompt:
            getIdentityPrompt(),

          image_urls: [
            body.image_url
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

        const falResponse =
          await fetch(
            "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
            {
              method: "POST",

              headers: {
                "Authorization":
                  `Key ${this.env.FAL_KEY}`,

                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify(
                  falBody
                )
            }
          );

        const falText =
          await falResponse.text();

        let falData;

        try {
          falData =
            JSON.parse(falText);
        } catch {
          falData = null;
        }

        if (
          !falResponse.ok ||
          !falData
        ) {

          job.status =
            "error";

          job.stage_1_status =
            "error";

          job.error =
            falText ||
            "Stage 1 submission failed.";

          job.updated_at =
            new Date().toISOString();

          await this.ctx.storage.put(
            "job",
            job
          );

          return controllerJson(
            {
              ok: false,
              error:
                "Stage 1 submission failed.",
              details:
                falText,
              job: job
            },
            500
          );
        }

        job.stage_1_status =
          "submitted";

        job.stage_1_request_id =
          falData.request_id || null;

        job.stage_1_status_url =
          falData.status_url || null;

        job.stage_1_response_url =
          falData.response_url || null;

        job.fal_called =
          true;

        job.updated_at =
          new Date().toISOString();

        await this.ctx.storage.put(
          "job",
          job
        );

        return controllerJson({
          ok: true,

          message:
            "Stage 1 submitted.",

          job: job
        });
      }

      // ============================================================
      // ADVANCE JOB
      // ============================================================

      if (body.action === "advance_job") {

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

        // Already complete.

        if (
          job.status ===
          "completed"
        ) {

          return controllerJson({
            ok: true,

            message:
              "Q Master is ready.",

            job: job
          });
        }

        // Existing error.

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
              job: job
            },
            500
          );
        }

        // ==========================================================
        // STAGE 1 STATUS
        // ==========================================================

        if (
          job.stage_1_status ===
          "submitted" ||
          job.stage_1_status ===
          "processing"
        ) {

          const result =
            await checkFalJob(
              job.stage_1_status_url,
              job.stage_1_response_url,
              this.env.FAL_KEY
            );

          if (
            result.state ===
            "processing"
          ) {

            job.stage_1_status =
              "processing";

            job.updated_at =
              new Date().toISOString();

            await this.ctx.storage.put(
              "job",
              job
            );

            return controllerJson({
              ok: true,

              message:
                "Stage 1 is processing.",

              job: job
            });
          }

          if (
            result.state ===
            "error"
          ) {

            job.status =
              "error";

            job.stage_1_status =
              "error";

            job.error =
              result.error;

            job.updated_at =
              new Date().toISOString();

            await this.ctx.storage.put(
              "job",
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  result.error,
                job: job
              },
              500
            );
          }

          if (
            result.state ===
            "completed"
          ) {

            const imageUrl =
              extractFalImage(
                result.data
              );

            if (!imageUrl) {

              job.status =
                "error";

              job.stage_1_status =
                "error";

              job.error =
                "Stage 1 completed but no image URL was found.";

              job.updated_at =
                new Date().toISOString();

              await this.ctx.storage.put(
                "job",
                job
              );

              return controllerJson(
                {
                  ok: false,
                  error:
                    job.error,
                  job: job
                },
                500
              );
            }

            job.stage_1_status =
              "completed";

            job.stage_1_image =
              imageUrl;

            job.stage =
              "stage_2";

            job.updated_at =
              new Date().toISOString();

            await this.ctx.storage.put(
              "job",
              job
            );
          }
        }

        // ==========================================================
        // SUBMIT STAGE 2
        // ==========================================================

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

          job.updated_at =
            new Date().toISOString();

          await this.ctx.storage.put(
            "job",
            job
          );

          const falBody = {

            prompt:
              getQMasterPrompt(),

            image_urls: [
              job.stage_1_image
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

          const falResponse =
            await fetch(
              "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
              {
                method: "POST",

                headers: {
                  "Authorization":
                    `Key ${this.env.FAL_KEY}`,

                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify(
                    falBody
                  )
              }
            );

          const falText =
            await falResponse.text();

          let falData;

          try {
            falData =
              JSON.parse(falText);
          } catch {
            falData = null;
          }

          if (
            !falResponse.ok ||
            !falData
          ) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              falText ||
              "Stage 2 submission failed.";

            job.updated_at =
              new Date().toISOString();

            await this.ctx.storage.put(
              "job",
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  "Stage 2 submission failed.",
                details:
                  falText,
                job: job
              },
              500
            );
          }

          job.stage_2_status =
            "submitted";

          job.stage_2_request_id =
            falData.request_id || null;

          job.stage_2_status_url =
            falData.status_url || null;

          job.stage_2_response_url =
            falData.response_url || null;

          job.updated_at =
            new Date().toISOString();

          await this.ctx.storage.put(
            "job",
            job
          );

          return controllerJson({
            ok: true,

            message:
              "Stage 1 complete. Stage 2 submitted.",

            job: job
          });
        }

        // ==========================================================
        // STAGE 2 STATUS
        // ==========================================================

        if (
          job.stage_2_status ===
            "submitted" ||
          job.stage_2_status ===
            "processing"
        ) {

          const result =
            await checkFalJob(
              job.stage_2_status_url,
              job.stage_2_response_url,
              this.env.FAL_KEY
            );

          if (
            result.state ===
            "processing"
          ) {

            job.stage_2_status =
              "processing";

            job.updated_at =
              new Date().toISOString();

            await this.ctx.storage.put(
              "job",
              job
            );

            return controllerJson({
              ok: true,

              message:
                "Stage 2 is processing.",

              job: job
            });
          }

          if (
            result.state ===
            "error"
          ) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              result.error;

            job.updated_at =
              new Date().toISOString();

            await this.ctx.storage.put(
              "job",
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  result.error,
                job: job
              },
              500
            );
          }

          if (
            result.state ===
            "completed"
          ) {

            const imageUrl =
              extractFalImage(
                result.data
              );

            if (!imageUrl) {

              job.status =
                "error";

              job.stage_2_status =
                "error";

              job.error =
                "Stage 2 completed but no image URL was found.";

              job.updated_at =
                new Date().toISOString();

              await this.ctx.storage.put(
                "job",
                job
              );

              return controllerJson(
                {
                  ok: false,
                  error:
                    job.error,
                  job: job
                },
                500
              );
            }

            job.stage_2_status =
              "completed";

            job.stage_2_image =
              imageUrl;

            job.final_image =
              imageUrl;

            job.status =
              "completed";

            job.stage =
              "completed";

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
                "STAGYLIGHT Q Master completed.",

              job: job
            });
          }
        }

        // Nothing to advance yet.

        return controllerJson({
          ok: true,

          message:
            "Job is waiting.",

          job: job
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
// FAL JOB CHECKER
// ================================================================

async function checkFalJob(
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

  const statusResponse =
    await fetch(
      statusUrl,
      {
        headers: {
          "Authorization":
            `Key ${falKey}`
        }
      }
    );

  const statusText =
    await statusResponse.text();

  let statusData;

  try {
    statusData =
      JSON.parse(statusText);
  } catch {

    return {
      state: "error",
      error:
        "Invalid fal.ai status response."
    };
  }

  if (!statusResponse.ok) {

    return {
      state: "error",
      error:
        statusData?.detail ||
        statusData?.error ||
        statusText
    };
  }

  const status =
    String(
      statusData.status || ""
    ).toUpperCase();

  if (
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS"
  ) {

    return {
      state: "processing",
      data: statusData
    };
  }

  if (
    status === "COMPLETED"
  ) {

    if (!responseUrl) {

      return {
        state: "error",
        error:
          "fal.ai completed but response URL is missing."
      };
    }

    const resultResponse =
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
      await resultResponse.text();

    let resultData;

    try {
      resultData =
        JSON.parse(resultText);
    } catch {

      return {
        state: "error",
        error:
          "Invalid fal.ai result response."
      };
    }

    if (!resultResponse.ok) {

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

  return {
    state: "processing",
    data: statusData
  };
}


// ================================================================
// EXTRACT GENERATED IMAGE
// ================================================================

function extractFalImage(data) {

  if (
    data &&
    Array.isArray(data.images) &&
    data.images.length > 0 &&
    data.images[0] &&
    data.images[0].url
  ) {

    return data.images[0].url;
  }

  return null;
}


// ================================================================
// STAGE 1 PROMPT
// HUMAN PHOTO -> IDENTITY MASTER
// ================================================================

function getIdentityPrompt() {

  return `

Create ONE premium illustrated portrait of the EXACT SAME PERSON
shown in the supplied reference photograph.

This is STAGYLIGHT IDENTITY MASTER — STAGE 1.

THIS IS NOT THE FINAL Q CHARACTER.

The highest priority is preserving the real person's recognizable
adult identity.

The finished portrait must immediately look like the SAME PERSON,
not a fictional character inspired by them.

Preserve:

- overall face shape
- forehead proportions
- cheek structure and width
- jawline
- chin
- eyebrow shape and position
- natural eye shape and size
- eye spacing
- eyelids
- nose shape, width and proportions
- mouth shape
- lip proportions
- natural facial balance
- natural skin tone
- distinctive facial characteristics
- visible gender presentation
- apparent adult age

Do NOT replace the face with generic anime or cartoon features.

Do NOT beautify the person into somebody else.

Keep mature adult facial proportions.

Do NOT create:

- a baby
- toddler
- child
- baby-faced doll
- childlike chibi
- huge anime eyes
- excessively round cheeks
- tiny nose
- tiny chin

Preserve the person's hairstyle extremely carefully.

Preserve:

- haircut
- hairline
- hair length
- fringe
- swept direction
- side shape
- top volume
- texture
- colour distribution
- dark and light areas

Do NOT redesign the hairstyle.

If the reference accidentally crops the highest part of the hair,
naturally reconstruct the continuation of the SAME hairstyle.

Preserve the visible clothing type, main colours and clearly
visible accessories.

Do not invent a completely different outfit.

Do not add cosmetic styling that is not clearly present.

Do NOT add:

- lipstick
- eyeliner
- eyeshadow
- artificial eyelashes
- cosmetic blush
- beauty makeup
- pink cosmetic cheeks

Use a natural pleasant adult expression.

COMPOSITION IS CRITICAL.

Nothing important may be cropped.

Zoom out when necessary.

The complete hairstyle and highest point of the hair must be
inside the square canvas.

Leave approximately 10 to 15 percent clean background space
above the highest point of the hairstyle.

Leave comfortable space on both sides.

Keep completely inside the canvas:

- full hairstyle
- top of head
- sides of hair
- ears where naturally visible
- complete face
- chin
- neck
- shoulders
- upper chest

Frame approximately from upper chest upward.

Center the person.

Use a simple clean neutral background.

STYLE:

Create a polished premium digital illustration with clean edges,
smooth controlled shading and refined facial detail.

Only mild illustration stylization is allowed.

REAL-PERSON IDENTITY must remain much stronger than stylization.

Do NOT apply Q-character proportions yet.

Do NOT substantially enlarge the head.

Do NOT substantially shrink the body.

Do NOT make the person look like a toy, doll or baby.

FINAL PRIORITY:

1. SAME REAL PERSON
2. ADULT FACIAL IDENTITY
3. SAME HAIRSTYLE
4. FULL HEAD AND HAIR INSIDE FRAME
5. SAME CLOTHING AND ACCESSORIES
6. NATURAL PRESENTATION
7. PREMIUM ILLUSTRATION QUALITY

If stylization conflicts with identity, preserve identity.

Generate exactly ONE centered square portrait.

`;
}


// ================================================================
// STAGE 2 PROMPT
// IDENTITY MASTER -> CUTE ADULT Q MASTER
// ================================================================

function getQMasterPrompt() {

  return `

Transform the supplied STAGYLIGHT IDENTITY MASTER into ONE
premium CUTE ADULT Q CHARACTER.

IMPORTANT:

The supplied image already represents the correct person's identity.

DO NOT invent a new character.

DO NOT replace the person with a generic chibi character.

STYLIZE THE SUPPLIED PERSON THEMSELVES.

The target balance is approximately:

80 percent recognizable personal identity
20 percent controlled Q-character stylization.

The finished Q character must remain immediately recognizable
as the SAME ADULT PERSON shown in the supplied Identity Master.

============================================================
IDENTITY LOCK
============================================================

Preserve:

- recognizable face shape
- forehead proportions
- cheek structure
- jawline
- chin
- eyebrow identity
- natural eye identity
- eye spacing
- nose identity
- mouth identity
- lip proportions
- skin tone
- distinctive facial characteristics
- visible gender presentation
- adult appearance

Do NOT replace these with generic anime features.

Do NOT make the person look like a different individual.

============================================================
CUTE Q STYLE
============================================================

Apply controlled premium Q-character styling.

Use:

- moderately larger head
- moderately smaller upper body
- cute polished proportions
- clean smooth illustration
- friendly expressive character quality
- premium sticker/avatar finish

The Q styling should be noticeable but controlled.

The character MUST STILL LOOK LIKE AN ADULT.

Do NOT create:

- baby proportions
- toddler proportions
- child proportions
- baby-faced chibi
- giant anime eyes
- doll face
- extremely round face
- tiny nose
- tiny chin

Do not destroy the natural jawline.

Do not shorten the lower face excessively.

The face must remain recognizable.

============================================================
EYES
============================================================

Eyes may become only MILDLY more expressive.

Do NOT create giant round anime eyes.

Do NOT dramatically enlarge the eyes.

Preserve the person's recognizable natural eye shape and spacing.

============================================================
HAIR IDENTITY LOCK
============================================================

The hairstyle is part of the person's identity.

Preserve:

- exact hairstyle concept
- hairline
- fringe
- swept direction
- top volume
- side shape
- texture
- hair length
- visible colour distribution
- dark and light areas

Do NOT redesign the hairstyle.

Do NOT replace it with a generic cartoon hairstyle.

============================================================
CLOTHING AND ACCESSORIES
============================================================

Preserve the same recognizable clothing and accessories from
the supplied Identity Master.

Do not randomly change clothing.

Do not invent unrelated accessories.

============================================================
NO UNWANTED MAKEUP
============================================================

Do NOT add cosmetic styling that is not already present.

Do NOT add:

- lipstick
- eyeliner
- eyeshadow
- prominent artificial eyelashes
- cosmetic blush
- pink cheeks
- beauty makeup

Cute appearance must come from illustration style,
expression and controlled proportions — NOT makeup.

============================================================
EXPRESSION
============================================================

Use a pleasant, cheerful and approachable expression suitable
for the person's MASTER Q avatar.

Keep the person's recognizable facial character.

Do not distort the mouth into an exaggerated cartoon expression.

============================================================
CRITICAL FULL-FRAME COMPOSITION
============================================================

NOTHING IMPORTANT MAY BE CROPPED.

The ENTIRE hairstyle must remain visible.

The highest point of the hair must be completely inside
the square canvas.

Leave approximately 10 to 15 percent clean background space
above the hairstyle.

Leave comfortable space on both sides.

Keep fully visible:

- complete hairstyle
- complete top of head
- both sides of hair
- ears where naturally visible
- full face
- chin
- neck
- shoulders
- upper body

Nothing important may touch the canvas edge.

ZOOM OUT when necessary.

Center the character.

============================================================
STYLE
============================================================

Create a premium modern STAGYLIGHT Q-character illustration.

Use:

- clean digital artwork
- polished smooth rendering
- clean edges
- controlled soft shading
- cute but mature character design
- high-quality avatar/sticker aesthetic
- consistent professional illustration

Do not make it photorealistic.

Do not make it a generic anime character.

Do not make it a baby.

Do not add text.

Do not add watermark.

Do not add logos.

Do not add another person.

Do not create a collage.

Do not create multiple versions.

Use a simple clean neutral background.

============================================================
FINAL PRIORITY
============================================================

1. SAME PERSON / RECOGNIZABLE IDENTITY
2. ADULT APPEARANCE
3. SAME HAIRSTYLE
4. CUTE CONTROLLED Q STYLE
5. SAME CLOTHING / ACCESSORIES
6. NO COSMETIC BLUSH OR UNWANTED MAKEUP
7. FULL HAIR AND BODY ELEMENTS INSIDE FRAME
8. PREMIUM STAGYLIGHT CHARACTER QUALITY

The Q transformation must NEVER overpower identity.

Do not invent a new Q character.

Stylize the supplied Identity Master itself.

Generate exactly ONE square Cute Adult Q Master.

`;
}


// ================================================================
// DURABLE OBJECT RESPONSE HELPER
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
