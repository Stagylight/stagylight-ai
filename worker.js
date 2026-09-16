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
          "Transform the supplied photograph into ONE cute, friendly and polished " +
          "Q-version character of the SAME PERSON. The character must remain clearly " +
          "recognizable as the person in the reference photograph while having a warm, " +
          "appealing Q-character illustration style. " +

          "Preserve the person's recognizable face shape, eyebrows, natural eye shape " +
          "and spacing, nose, mouth, skin tone and important facial characteristics. " +
          "Keep enough facial likeness that friends of the person could recognize them. " +

          "Give the character a warm, cheerful and approachable expression with a gentle " +
          "natural smile. The character should look happy, lively and friendly, never " +
          "blank, emotionless, uncanny, creepy, stiff or frightening. " +

          "Use cute Q-version proportions with a moderately larger head, compact smaller " +
          "body and softly simplified facial features. Make the cheeks slightly softer " +
          "and the overall illustration charming, youthful and expressive while still " +
          "preserving the person's recognizable identity. " +

          "Keep the eyes lively and friendly but reasonably proportional to the person's " +
          "real eye shape. Do not use extremely large anime eyes. Do not add exaggerated " +
          "eyelashes, eyeliner, eyeshadow, lipstick, heavy makeup or cosmetic features " +
          "that are not visible in the reference photograph. " +

          "Preserve the person's visible gender presentation exactly as shown. Do not " +
          "feminize or masculinize the subject. " +

          "Preserve the hairstyle, hair length, haircut, hair direction and hair colour " +
          "shown in the reference photograph. Do not invent longer hair or a different hairstyle. " +

          "Preserve the clothing type, design and main colours shown in the reference photograph. " +

          "Use smooth clean illustration lines, soft natural facial shading and a polished " +
          "premium sticker-character appearance. Avoid harsh facial shadows, rigid facial " +
          "features, expressionless staring or an overly realistic uncanny appearance. " +

          "Generate exactly ONE character, ONE pose and ONE portrait. Do not create a " +
          "collage, character sheet, multiple versions or multiple people. " +

          "Use a simple clean background.",

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
