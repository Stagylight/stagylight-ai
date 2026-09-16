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
          "Edit the supplied photograph into ONE mildly stylized Q-version " +
          "portrait of the EXACT SAME PERSON. FACIAL LIKENESS AND IDENTITY " +
          "ARE THE HIGHEST PRIORITY. The finished portrait must remain " +
          "immediately recognizable as the person in the source photograph. " +

          "Do not invent, redesign, beautify or replace the face. Preserve " +
          "the person's distinctive face shape, jawline, cheek proportions, " +
          "forehead proportions, eyebrow shape and position, natural eye " +
          "shape and spacing, nose shape and proportions, mouth shape, lip " +
          "proportions and overall facial geometry from the source photograph. " +

          "Keep the eyes close to their original natural shape and relative " +
          "size. Do NOT create huge anime eyes. Do NOT add prominent eyelashes, " +
          "eyeliner, eyeshadow, lipstick, makeup, cosmetic blush or feminine " +
          "beautification that is not present in the source photograph. " +

          "Preserve the person's visible gender presentation exactly as shown " +
          "in the source image. Do not feminize or masculinize the subject. " +

          "Preserve the exact hairstyle, hair length, haircut, hair direction " +
          "and hair colour visible in the source photograph. Do not lengthen " +
          "the hair or redesign the hairstyle. " +

          "Preserve the same clothing type, design and main colours visible " +
          "in the source photograph. " +

          "Apply only MODERATE Q-version stylization. Use a slightly larger " +
          "head and slightly simplified illustrated features, but keep the " +
          "person's unique facial proportions and identity. The result should " +
          "look like a recognizable illustrated miniature of the real person, " +
          "not a generic anime character. " +

          "Cuteness is SECONDARY to facial likeness. If stronger chibi " +
          "stylization would reduce recognition, preserve the realistic " +
          "facial features instead. " +

          "Generate exactly ONE person, ONE pose and ONE portrait. Do not " +
          "generate a collage, character sheet, multiple versions or multiple people. " +

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
