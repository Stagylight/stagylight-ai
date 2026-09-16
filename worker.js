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
        prompt:
          "Transform the person in this exact reference image into ONE cute " +
          "high-quality Q-version chibi character. " +

          "This is an IMAGE TRANSFORMATION, not a new character design. " +
          "Keep the person clearly recognizable as the same individual. " +

          "Preserve the exact visible hairstyle, hair length, hair colour, " +
          "face shape, skin tone, eyebrows, eye shape, nose, mouth and " +
          "visible gender presentation of the person in the source image. " +

          "Preserve the same clothing type and main clothing colours shown " +
          "in the source image. Do not redesign the person's outfit. " +

          "Do not add long hair, makeup, lipstick, prominent eyelashes, " +
          "facial hair, jewellery or accessories unless they already appear " +
          "in the source image. " +

          "Change only the visual style and body proportions into a polished " +
          "Q-version chibi illustration with a slightly larger head and " +
          "smaller body. Keep facial proportions recognizable rather than " +
          "using extremely oversized anime eyes. " +

          "Generate exactly ONE character only. Do not create a character " +
          "sheet, collage, multiple poses, multiple people, comparison image " +
          "or alternate versions. " +

          "Use a simple clean background and a friendly natural expression.",

        image_url: body.image_url,

        num_images: 1,

        aspect_ratio: "1:1",

        output_format: "jpeg",

        safety_tolerance: "2"
      };

      const response = await fetch(
        "https://queue.fal.run/fal-ai/flux-pro/kontext",
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
