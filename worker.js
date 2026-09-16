// ================================================================
// STAGYLIGHT AI WORKER
//
// TWO-STAGE MASTER Q SYSTEM
//
// Stage 1:
// Human Photo -> Identity Master
//
// Stage 2:
// Identity Master -> Cute Adult Q Master
//
// Durable Object:
// AIJobController
// ================================================================


const FAL_EDIT_ENDPOINT =
  "https://queue.fal.run/fal-ai/gpt-image-1.5/edit";


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
    // SIMPLE HEALTH CHECK
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
      // FREE DURABLE OBJECT TEST
      //
      // DOES NOT CALL FAL.AI
      // ============================================================

      if (body.action === "job_test") {

        const controller = getController(
          env,
          "stagylight-test-controller"
        );

        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/test",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "test"
              })
            }
          )
        );

        return proxyControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // CREATE REAL TWO-STAGE Q JOB
      //
      // WARNING:
      // THIS STARTS STAGE 1 AND USES AN AI GENERATION.
      // ============================================================

      if (body.action === "create_q_job") {

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


        const jobId = crypto.randomUUID();

        const controller = getController(
          env,
          jobId
        );


        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/create",
            {
              method: "POST",

              headers: {
                "Content-Type": "application/json"
              },

              body: JSON.stringify({
                action: "create",
                job_id: jobId,
                image_url: body.image_url
              })
            }
          )
        );


        return proxyControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // CHECK / ADVANCE TWO-STAGE JOB
      //
      // Android can repeatedly call this.
      //
      // The Durable Object decides whether:
      //
      // Stage 1 is still running
      // Stage 1 finished -> submit Stage 2
      // Stage 2 is still running
      // Stage 2 finished -> return final Q
      // ============================================================

      if (
        body.action === "q_job_status" &&
        body.job_id
      ) {

        const controller = getController(
          env,
          body.job_id
        );


        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/status",
            {
              method: "POST",

              headers: {
                "Content-Type": "application/json"
              },

              body: JSON.stringify({
                action: "status",
                job_id: body.job_id
              })
            }
          )
        );


        return proxyControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // GET FINAL Q RESULT
      // ============================================================

      if (
        body.action === "q_job_result" &&
        body.job_id
      ) {

        const controller = getController(
          env,
          body.job_id
        );


        const response = await controller.fetch(
          new Request(
            "https://stagylight.internal/result",
            {
              method: "POST",

              headers: {
                "Content-Type": "application/json"
              },

              body: JSON.stringify({
                action: "result",
                job_id: body.job_id
              })
            }
          )
        );


        return proxyControllerResponse(
          response,
          corsHeaders
        );
      }


      // ============================================================
      // OLD STATUS / RESULT PROXY
      //
      // PRESERVED FOR CURRENT ANDROID CODE
      // ============================================================

      if (
        body.action === "status" &&
        body.url
      ) {

        const statusResponse = await fetch(
          body.url,
          {
            headers: {
              "Authorization":
                `Key ${env.FAL_KEY}`
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
      // LEGACY SINGLE-STAGE GENERATION
      //
      // PRESERVED TEMPORARILY.
      //
      // Existing Android generation continues to work until we
      // deliberately switch Android to create_q_job.
      // ============================================================

      if (body.image_url) {

        const falBody = {

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
          FAL_EDIT_ENDPOINT,
          {
            method: "POST",

            headers: {
              "Authorization":
                `Key ${env.FAL_KEY}`,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(falBody)
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
      }


      // ============================================================
      // UNKNOWN REQUEST
      // ============================================================

      return jsonResponse(
        {
          ok: false,
          error: "Unknown STAGYLIGHT AI action."
        },
        400,
        corsHeaders
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
// GET DURABLE OBJECT
// ================================================================

function getController(env, name) {

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


// ================================================================
// PROXY DURABLE OBJECT RESPONSE
// ================================================================

async function proxyControllerResponse(
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
          response.headers.get(
            "Content-Type"
          ) ||
          "application/json"
      }
    }
  );
}


// ================================================================
// JSON RESPONSE
// ================================================================

function jsonResponse(
  data,
  status = 200,
  corsHeaders = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json"
      }
    }
  );
}


// ================================================================
// STAGE 1 PROMPT
//
// HUMAN PHOTO -> IDENTITY MASTER
// ================================================================

function getIdentityPrompt() {

  return `

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

Treat the supplied photograph as the authoritative identity
reference.

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

Do NOT replace these features with generic cartoon features.

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

Use a natural pleasant expression suitable for a premium
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

Frame approximately from the upper chest upward.

Make the person smaller within the canvas if necessary.

CENTER the person horizontally.

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

Do not add text.
Do not add a watermark.
Do not add another person.
Do not create multiple versions.
Do not create a collage.
Do not create a character sheet.

============================================================
FINAL PRIORITY
============================================================

1. SAME PERSON / FACIAL IDENTITY
2. ADULT APPEARANCE
3. SAME HAIRSTYLE
4. COMPLETE HEAD AND HAIR INSIDE FRAME
5. SAME CLOTHING / ACCESSORIES
6. NATURAL PRESENTATION
7. PREMIUM ILLUSTRATION QUALITY

When there is any conflict between making the portrait more
stylized and preserving identity, ALWAYS preserve identity.

Generate exactly ONE centered square illustrated adult portrait.

`;
}


// ================================================================
// STAGE 2 PROMPT
//
// IDENTITY MASTER -> CUTE ADULT Q MASTER
// ================================================================

function getQPrompt() {

  return `

Transform the supplied STAGYLIGHT IDENTITY MASTER into ONE
premium cute adult Q-character.

CRITICAL:

DO NOT invent a new character.

STYLIZE THE SUPPLIED IDENTITY MASTER ITSELF.

The finished Q-character must remain immediately recognizable
as the SAME PERSON represented by the supplied Identity Master.

Target approximately:

80 percent recognizable personal identity
20 percent controlled Q-character stylization.

============================================================
IDENTITY MUST REMAIN STRONG
============================================================

Preserve:

- recognizable face shape
- recognizable jawline
- recognizable chin
- eyebrow shape
- natural eye character
- eye spacing
- nose identity
- mouth identity
- facial balance
- skin tone
- hairstyle
- hairline
- hair colour
- hair direction
- clothing
- visible accessories
- gender presentation
- adult appearance

Do NOT replace the face with a generic cute character face.

Do NOT make the person look like a completely different person.

============================================================
CUTE ADULT Q STYLE
============================================================

Create a polished cute Q-character illustration.

Use MODERATE Q proportions.

The head may be moderately larger than realistic proportions.

The body may be moderately smaller.

But the character must still look like a cute illustrated
ADULT version of the same person.

Do NOT create:

- baby proportions
- toddler proportions
- infant appearance
- baby-faced doll appearance
- extremely round baby cheeks
- tiny baby nose
- giant anime eyes
- oversized doll eyes

The face must preserve enough mature structure to maintain
identity.

============================================================
EYES
============================================================

The eyes may be slightly more expressive than Stage 1.

However:

Do NOT create giant anime eyes.

Do NOT dramatically change the natural eye shape.

Do NOT dramatically change eye spacing.

Identity is more important than exaggerated cuteness.

============================================================
FACE
============================================================

Do not make the face excessively round.

Do not erase the jawline.

Do not make the chin extremely tiny.

Do not replace the nose with a tiny generic cartoon nose.

Do not replace the mouth with a generic doll mouth.

Maintain recognizable facial geometry.

============================================================
HAIR
============================================================

Preserve the EXACT hairstyle established in the Identity Master.

Preserve:

- haircut
- hairline
- fringe
- swept direction
- top volume
- side shape
- texture
- light and dark colour distribution

Do NOT redesign the hairstyle.

============================================================
CLOTHING AND ACCESSORIES
============================================================

Preserve the clothing and main colours established in the
Identity Master.

Preserve clearly visible accessories.

Do not randomly redesign the outfit.

============================================================
NO UNWANTED COSMETICS
============================================================

Do NOT add cosmetic styling that is not already present.

Do NOT add:

- pink cosmetic blush
- lipstick
- eyeliner
- eyeshadow
- exaggerated eyelashes
- beauty makeup

Cute appearance must come from controlled Q proportions,
expression and illustration style — NOT cosmetic makeup.

============================================================
EXPRESSION
============================================================

Use a friendly, happy and appealing expression suitable for
the person's MASTER Q avatar.

Keep the expression natural enough that facial identity
remains recognizable.

Do not distort the face with an extreme expression.

============================================================
COMPOSITION
============================================================

NOTHING IMPORTANT MAY BE CROPPED.

The complete hairstyle must be visible.

The highest point of the hair must remain comfortably inside
the square canvas.

Leave approximately 10 to 15 percent clean background space
above the highest point of the hairstyle.

Leave safe background space on both sides.

Keep completely inside the frame:

- full hairstyle
- top of head
- sides of hair
- ears where naturally visible
- face
- chin
- neck
- shoulders
- upper body

Nothing important should touch the canvas edge.

Use a centered square composition.

============================================================
STYLE
============================================================

Use:

- premium modern Q-character illustration
- smooth clean rendering
- polished linework
- controlled soft shading
- cute but mature adult proportions
- expressive but recognizable face
- professional avatar quality
- clean attractive finish

The result should feel suitable as the permanent STAGYLIGHT
Master Q used to generate future stickers and reactions.

============================================================
BACKGROUND
============================================================

Use a simple clean neutral background.

Do not add text.
Do not add logos.
Do not add a watermark.
Do not add another person.
Do not create multiple characters.
Do not create a collage.
Do not create a character sheet.

============================================================
FINAL PRIORITY
============================================================

1. SAME PERSON
2. SAME FACE IDENTITY
3. SAME HAIRSTYLE
4. ADULT — NOT BABY
5. SAME CLOTHING / ACCESSORIES
6. COMPLETE HAIR AND HEAD INSIDE FRAME
7. CUTE CONTROLLED Q STYLE
8. PREMIUM FINISH

If stronger Q stylization would damage identity,
REDUCE the Q stylization.

Do not invent a new Q character.

Stylize the supplied Identity Master itself.

Generate exactly ONE centered square Cute Adult Q Master.

`;
}


// ================================================================
// FAL HELPERS
// ================================================================

async function submitFalEdit(
  env,
  imageUrl,
  prompt
) {

  const response = await fetch(
    FAL_EDIT_ENDPOINT,
    {
      method: "POST",

      headers: {
        "Authorization":
          `Key ${env.FAL_KEY}`,

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


  const text =
    await response.text();


  let data;


  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "fal.ai returned invalid JSON: " +
      text
    );
  }


  if (!response.ok) {
    throw new Error(
      data.detail ||
      data.error ||
      "fal.ai submission failed."
    );
  }


  return data;
}


async function fetchFalJson(
  env,
  url
) {

  const response = await fetch(
    url,
    {
      headers: {
        "Authorization":
          `Key ${env.FAL_KEY}`
      }
    }
  );


  const text =
    await response.text();


  let data;


  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "fal.ai returned invalid JSON."
    );
  }


  if (!response.ok) {
    throw new Error(
      data.detail ||
      data.error ||
      "fal.ai request failed."
    );
  }


  return data;
}


function getFalStatus(data) {

  return String(
    data.status ||
    data.state ||
    ""
  ).toUpperCase();
}


function extractImageUrl(data) {

  if (
    data &&
    Array.isArray(data.images) &&
    data.images.length > 0 &&
    data.images[0] &&
    data.images[0].url
  ) {
    return data.images[0].url;
  }


  if (
    data &&
    data.data &&
    Array.isArray(data.data.images) &&
    data.data.images.length > 0 &&
    data.data.images[0] &&
    data.data.images[0].url
  ) {
    return data.data.images[0].url;
  }


  return null;
}


// ================================================================
// DURABLE OBJECT
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


      // ==========================================================
      // FREE TEST
      // ==========================================================

      if (body.action === "test") {

        return this.json({
          ok: true,
          controller:
            "AIJobController",
          message:
            "STAGYLIGHT AI Job Controller is ready",
          fal_called: false
        });
      }


      // ==========================================================
      // CREATE REAL JOB
      // ==========================================================

      if (body.action === "create") {

        if (!body.image_url) {

          return this.json(
            {
              ok: false,
              error:
                "No reference image received."
            },
            400
          );
        }


        const existing =
          await this.ctx.storage.get(
            "job"
          );


        if (
          existing &&
          existing.status !== "completed" &&
          existing.status !== "failed"
        ) {

          return this.json(
            {
              ok: false,
              error:
                "This STAGYLIGHT AI job is already active."
            },
            409
          );
        }


        // --------------------------------------------------------
        // Submit Stage 1
        // --------------------------------------------------------

        const stage1 =
          await submitFalEdit(
            this.env,
            body.image_url,
            getIdentityPrompt()
          );


        if (
          !stage1.status_url ||
          !stage1.response_url
        ) {

          return this.json(
            {
              ok: false,
              error:
                "Stage 1 did not return the required fal.ai queue URLs."
            },
            502
          );
        }


        const job = {

          job_id: body.job_id,

          status: "processing",

          stage:
            "stage1_identity_master",

          original_image_url:
            body.image_url,

          stage1_status_url:
            stage1.status_url,

          stage1_response_url:
            stage1.response_url,

          stage1_image_url:
            null,

          stage2_status_url:
            null,

          stage2_response_url:
            null,

          final_q_url:
            null,

          created_at:
            new Date().toISOString(),

          updated_at:
            new Date().toISOString(),

          error:
            null
        };


        await this.ctx.storage.put(
          "job",
          job
        );


        return this.json({
          ok: true,

          job_id:
            job.job_id,

          status:
            job.status,

          stage:
            job.stage,

          message:
            "Stage 1 Identity Master started."
        });
      }


      // ==========================================================
      // STATUS / ADVANCE JOB
      // ==========================================================

      if (body.action === "status") {

        let job =
          await this.ctx.storage.get(
            "job"
          );


        if (!job) {

          return this.json(
            {
              ok: false,
              error:
                "STAGYLIGHT AI job not found."
            },
            404
          );
        }


        if (
          body.job_id &&
          job.job_id !== body.job_id
        ) {

          return this.json(
            {
              ok: false,
              error:
                "STAGYLIGHT AI job ID mismatch."
            },
            409
          );
        }


        // --------------------------------------------------------
        // Already finished
        // --------------------------------------------------------

        if (
          job.status === "completed"
        ) {

          return this.json({
            ok: true,
            job_id: job.job_id,
            status: "completed",
            stage: "completed",
            image_url:
              job.final_q_url
          });
        }


        // --------------------------------------------------------
        // Already failed
        // --------------------------------------------------------

        if (
          job.status === "failed"
        ) {

          return this.json(
            {
              ok: false,
              job_id:
                job.job_id,
              status:
                "failed",
              error:
                job.error ||
                "Q generation failed."
            },
            500
          );
        }


        // ========================================================
        // STAGE 1
        // ========================================================

        if (
          job.stage ===
          "stage1_identity_master"
        ) {

          const statusData =
            await fetchFalJson(
              this.env,
              job.stage1_status_url
            );


          const falStatus =
            getFalStatus(
              statusData
            );


          if (
            falStatus === "FAILED" ||
            falStatus === "ERROR"
          ) {

            job.status = "failed";

            job.error =
              "Stage 1 Identity Master failed.";

            job.updated_at =
              new Date().toISOString();


            await this.ctx.storage.put(
              "job",
              job
            );


            return this.json(
              {
                ok: false,
                job_id:
                  job.job_id,
                status:
                  "failed",
                error:
                  job.error
              },
              500
            );
          }


          if (
            falStatus !== "COMPLETED"
          ) {

            return this.json({
              ok: true,
              job_id:
                job.job_id,
              status:
                "processing",
              stage:
                "stage1_identity_master",
              fal_status:
                falStatus ||
                "PROCESSING"
            });
          }


          // ------------------------------------------------------
          // Stage 1 completed.
          // Get Stage 1 result.
          // ------------------------------------------------------

          const stage1Result =
            await fetchFalJson(
              this.env,
              job.stage1_response_url
            );


          const stage1Image =
            extractImageUrl(
              stage1Result
            );


          if (!stage1Image) {

            job.status = "failed";

            job.error =
              "Stage 1 completed but no Identity Master image was returned.";

            job.updated_at =
              new Date().toISOString();


            await this.ctx.storage.put(
              "job",
              job
            );


            return this.json(
              {
                ok: false,
                job_id:
                  job.job_id,
                status:
                  "failed",
                error:
                  job.error
              },
              500
            );
          }


          job.stage1_image_url =
            stage1Image;


          // ------------------------------------------------------
          // Submit Stage 2 using Stage-1 image.
          // ------------------------------------------------------

          const stage2 =
            await submitFalEdit(
              this.env,
              stage1Image,
              getQPrompt()
            );


          if (
            !stage2.status_url ||
            !stage2.response_url
          ) {

            job.status = "failed";

            job.error =
              "Stage 2 did not return the required fal.ai queue URLs.";

            job.updated_at =
              new Date().toISOString();


            await this.ctx.storage.put(
              "job",
              job
            );


            return this.json(
              {
                ok: false,
                job_id:
                  job.job_id,
                status:
                  "failed",
                error:
                  job.error
              },
              502
            );
          }


          job.stage =
            "stage2_q_master";

          job.stage2_status_url =
            stage2.status_url;

          job.stage2_response_url =
            stage2.response_url;

          job.updated_at =
            new Date().toISOString();


          await this.ctx.storage.put(
            "job",
            job
          );


          return this.json({
            ok: true,

            job_id:
              job.job_id,

            status:
              "processing",

            stage:
              "stage2_q_master",

            message:
              "Identity Master completed. Cute Q Master started."
          });
        }


        // ========================================================
        // STAGE 2
        // ========================================================

        if (
          job.stage ===
          "stage2_q_master"
        ) {

          const statusData =
            await fetchFalJson(
              this.env,
              job.stage2_status_url
            );


          const falStatus =
            getFalStatus(
              statusData
            );


          if (
            falStatus === "FAILED" ||
            falStatus === "ERROR"
          ) {

            job.status =
              "failed";

            job.error =
              "Stage 2 Cute Q Master failed.";

            job.updated_at =
              new Date().toISOString();


            await this.ctx.storage.put(
              "job",
              job
            );


            return this.json(
              {
                ok: false,
                job_id:
                  job.job_id,
                status:
                  "failed",
                error:
                  job.error
              },
              500
            );
          }


          if (
            falStatus !== "COMPLETED"
          ) {

            return this.json({
              ok: true,

              job_id:
                job.job_id,

              status:
                "processing",

              stage:
                "stage2_q_master",

              fal_status:
                falStatus ||
                "PROCESSING"
            });
          }


          // ------------------------------------------------------
          // Stage 2 completed.
          // Get final Q.
          // ------------------------------------------------------

          const stage2Result =
            await fetchFalJson(
              this.env,
              job.stage2_response_url
            );


          const finalQ =
            extractImageUrl(
              stage2Result
            );


          if (!finalQ) {

            job.status =
              "failed";

            job.error =
              "Stage 2 completed but no final Q image was returned.";

            job.updated_at =
              new Date().toISOString();


            await this.ctx.storage.put(
              "job",
              job
            );


            return this.json(
              {
                ok: false,
                job_id:
                  job.job_id,
                status:
                  "failed",
                error:
                  job.error
              },
              500
            );
          }


          job.final_q_url =
            finalQ;

          job.status =
            "completed";

          job.stage =
            "completed";

          job.updated_at =
            new Date().toISOString();


          await this.ctx.storage.put(
            "job",
            job
          );


          return this.json({
            ok: true,

            job_id:
              job.job_id,

            status:
              "completed",

            stage:
              "completed",

            image_url:
              job.final_q_url
          });
        }


        return this.json(
          {
            ok: false,
            error:
              "Unknown STAGYLIGHT job stage."
          },
          500
        );
      }


      // ==========================================================
      // RESULT
      // ==========================================================

      if (body.action === "result") {

        const job =
          await this.ctx.storage.get(
            "job"
          );


        if (!job) {

          return this.json(
            {
              ok: false,
              error:
                "STAGYLIGHT AI job not found."
            },
            404
          );
        }


        if (
          body.job_id &&
          job.job_id !== body.job_id
        ) {

          return this.json(
            {
              ok: false,
              error:
                "STAGYLIGHT AI job ID mismatch."
            },
            409
          );
        }


        if (
          job.status !== "completed"
        ) {

          return this.json({
            ok: true,
            job_id:
              job.job_id,
            status:
              job.status,
            stage:
              job.stage,
            image_url:
              null
          });
        }


        return this.json({
          ok: true,

          job_id:
            job.job_id,

          status:
            "completed",

          stage:
            "completed",

          image_url:
            job.final_q_url
        });
      }


      return this.json(
        {
          ok: false,
          error:
            "Unknown AIJobController action."
        },
        400
      );


    } catch (error) {

      // Save error if a real job exists.
      try {

        const job =
          await this.ctx.storage.get(
            "job"
          );


        if (job) {

          job.status =
            "failed";

          job.error =
            error.message;

          job.updated_at =
            new Date().toISOString();


          await this.ctx.storage.put(
            "job",
            job
          );
        }

      } catch (_) {
        // Ignore secondary storage error.
      }


      return this.json(
        {
          ok: false,
          error:
            error.message
        },
        500
      );
    }
  }


  json(
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
}
