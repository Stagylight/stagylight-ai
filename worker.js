export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("STAGYLIGHT AI Worker is working!", {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain"
        }
      });
    }

    try {
      const body = await request.json();

      // ==========================================
      // STATUS / RESULT REQUEST
      // ==========================================
      if (body.action === "status" && body.url) {
        const statusResponse = await fetch(body.url, {
          headers: {
            "Authorization": `Key ${env.FAL_KEY}`
          }
        });

        const statusData = await statusResponse.text();

        return new Response(statusData, {
          status: statusResponse.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      // ==========================================
      // CREATE MY Q
      // ==========================================

      if (!body.image_url) {
        return new Response(
          JSON.stringify({
            error: "No reference image received."
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      const falBody = {
        prompt: body.prompt,
        reference_image_url: body.image_url,

        image_size: "square_hd",

        num_inference_steps: 28,

        guidance_scale: 4,

        id_weight: 1.2,

        true_cfg: 1,

        negative_prompt:
          "different person, wrong identity, gender change, " +
          "different hairstyle, different hair color, " +
          "unrelated face, generic anime character, " +
          "unwanted dress, unwanted skirt, unwanted makeup, " +
          "text, watermark, signature, blurry, low quality, " +
          "deformed face, extra limbs",

        enable_safety_checker: true
      };

      const response = await fetch(
        "https://queue.fal.run/fal-ai/flux-pulid",
        {
          method: "POST",

          headers: {
            "Authorization": `Key ${env.FAL_KEY}`,
            "Content-Type": "application/json"
          },

          body: JSON.stringify(falBody)
        }
      );

      const data = await response.text();

      return new Response(data, {
        status: response.status,

        headers: {
          ...corsHeaders,

          "Content-Type":
            response.headers.get("Content-Type") ||
            "application/json"
        }
      });

    } catch (error) {

      return new Response(
        JSON.stringify({
          error: error.message
        }),
        {
          status: 500,

          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
  }
};
