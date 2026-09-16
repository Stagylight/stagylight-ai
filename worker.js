export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

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


      // ==========================================
      // STATUS / RESULT REQUEST
      // ==========================================

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
              "Content-Type": "application/json"
            }
          }
        );
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


      // ==========================================
      // STAGYLIGHT MY Q
      //
      // TARGET:
      // 80% RECOGNIZABLE IDENTITY
      // 20% CUTE Q STYLIZATION
      // ==========================================

      const falBody = {

        prompt:
          "Transform the supplied photograph into ONE cute STAGYLIGHT " +
          "Q-version illustration of the SAME PERSON. " +

          "This is an IMAGE EDIT, not a redesign of the person. " +

          "HIGHEST PRIORITY: preserve the person's identity and facial " +
          "likeness. The result must be immediately recognizable as the " +
          "same person from the reference photograph. " +

          "Keep the person's actual facial structure: same face shape, " +
          "forehead, jawline, cheeks, eyebrows, eye shape and spacing, " +
          "nose shape, mouth shape, lips, skin tone and distinctive " +
          "facial proportions. " +

          "Do not substitute a generic anime, chibi or doll face. " +

          "Keep the eyes close to their real natural shape and size. " +
          "Only slightly enlarge them if necessary for the Q style. " +
          "Do not create huge round anime eyes. " +

          "Preserve the exact hairstyle, haircut, hair length, hairline, " +
          "hair direction and hair colour visible in the photograph. " +

          "Preserve the person's visible gender presentation. " +

          "Do not add makeup, lipstick, eyeliner, eyeshadow or prominent " +
          "eyelashes unless those features already exist in the reference. " +

          "Preserve the same clothing design, clothing type and main " +
          "colours visible in the original photograph. " +

          "Give the person a warm, happy and friendly natural expression. " +

          "Apply a cute premium Q-character illustration style with a " +
          "moderately larger head and slightly smaller body. " +

          "Keep realistic recognizable facial features inside the " +
          "illustrated Q style. Identity is much more important than " +
          "exaggerated cartoon styling. " +

          "The desired visual balance is approximately 80 percent " +
          "recognizable real-person identity and 20 percent Q-character " +
          "stylization. " +

          "Generate exactly ONE person only. No second person. " +
          "No collage. No character sheet. No multiple poses. " +
          "No text. No watermark. " +

          "Use a simple clean background.",


        // GPT Image Edit expects an ARRAY of reference images
        image_urls: [
          body.image_url
        ],

        // Maximum reference-image preservation option
        input_fidelity: "high",

        // Square STAGYLIGHT My Q image
        image_size: "1024x1024",

        // Highest available generation quality
        quality: "high",

        background: "opaque",

        num_images: 1,

        output_format: "png",

        // Keep queue/result URL behaviour
        sync_mode: false
      };


      // ==========================================
      // SEND TO GPT-IMAGE 1.5 EDIT
      // ==========================================

      const response = await fetch(
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


      const data =
        await response.text();


      return new Response(
        data,
        {
          status: response.status,

          headers: {
            ...corsHeaders,

            "Content-Type":
              response.headers.get("Content-Type") ||
              "application/json"
          }
        }
      );


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
