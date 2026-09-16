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
      // ~80% RECOGNIZABLE IDENTITY
      // ~20% CUTE Q STYLIZATION
      //
      // IMPORTANT:
      // FULL HEAD + FULL HAIRSTYLE IN FRAME
      // ==========================================

      const falBody = {

        prompt:

          "Transform the supplied photograph into ONE premium cute " +
          "STAGYLIGHT Q-version illustration of the SAME PERSON. " +

          "This is an identity-preserving IMAGE EDIT. Do not redesign " +
          "or replace the person's face. " +


          // ======================================
          // IDENTITY
          // ======================================

          "FACIAL IDENTITY IS THE HIGHEST PRIORITY. " +

          "The finished character must be immediately recognizable as " +
          "the same real person shown in the supplied photograph. " +

          "Preserve the person's distinctive facial geometry and " +
          "individual appearance. Keep the same face shape, forehead " +
          "proportions, cheek proportions, jawline, chin, eyebrow shape, " +
          "eyebrow position, natural eye shape, eye spacing, nose shape, " +
          "nose proportions, mouth shape, lip proportions and overall " +
          "facial balance. " +

          "Do not replace these individual features with generic cute " +
          "character features. The illustrated face should resemble an " +
          "illustrated miniature of this exact real person. " +


          // ======================================
          // EYES
          // ======================================

          "Keep the person's natural eye shape clearly recognizable. " +

          "The eyes may be only mildly enlarged for Q-character styling. " +
          "Do not create huge, extremely round or generic anime eyes. " +

          "Preserve the original relationship between the eyes, eyebrows, " +
          "nose and mouth. " +


          // ======================================
          // HAIR
          // ======================================

          "Preserve the exact hairstyle shown in the reference photograph, " +
          "including haircut, hair length, hairline, fringe, side shape, " +
          "hair direction, volume and hair colour. " +

          "Do not redesign, shorten, lengthen or replace the hairstyle. " +


          // ======================================
          // VERY IMPORTANT FRAMING
          // ======================================

          "COMPOSITION AND FRAMING ARE VERY IMPORTANT. " +

          "SHOW THE ENTIRE HEAD AND THE COMPLETE HAIRSTYLE INSIDE THE IMAGE. " +

          "There must be comfortable visible background space ABOVE the " +
          "highest point of the person's hair. " +

          "Do NOT crop the top of the hair. " +
          "Do NOT crop either side of the hairstyle. " +
          "Do NOT crop the ears. " +
          "Do NOT crop the chin. " +

          "Frame the person approximately from the upper chest upward. " +

          "Make the character slightly smaller within the square canvas " +
          "if necessary so the complete head, hairstyle, ears, neck and " +
          "upper shoulders remain comfortably inside the image. " +

          "Center the character horizontally. " +

          "Leave approximately 10 percent clean background margin above " +
          "the complete hairstyle. " +


          // ======================================
          // GENDER / SKIN / CLOTHING
          // ======================================

          "Preserve the person's visible gender presentation exactly as " +
          "shown in the reference photograph. " +

          "Preserve the person's natural skin tone. " +

          "Do not add makeup, lipstick, eyeliner, eyeshadow, prominent " +
          "eyelashes or cosmetic styling unless clearly visible in the " +
          "reference photograph. " +

          "Preserve the clothing type, design and main colours visible " +
          "in the original photograph. Do not invent a different outfit. " +


          // ======================================
          // EXPRESSION
          // ======================================

          "Give the person a warm, happy, friendly and natural expression. " +

          "Use a gentle pleasant smile while keeping the person's natural " +
          "mouth shape and facial identity recognizable. " +


          // ======================================
          // Q STYLE
          // ======================================

          "Apply a polished premium Q-character illustration style. " +

          "Use a moderately larger head and slightly smaller upper body, " +
          "but do not distort the facial proportions so strongly that the " +
          "person becomes difficult to recognize. " +

          "Use clean smooth digital illustration, attractive soft rendering " +
          "and a modern cute character finish. " +

          "Identity accuracy is substantially more important than maximum " +
          "cartoon exaggeration. " +

          "The desired balance is approximately 80 percent recognizable " +
          "real-person identity and 20 percent cute Q-character stylization. " +


          // ======================================
          // DO NOT
          // ======================================

          "Do not create a generic anime face. " +
          "Do not create a generic chibi face. " +
          "Do not create a generic doll face. " +
          "Do not dramatically enlarge the eyes. " +
          "Do not change the person's ethnicity or skin tone. " +
          "Do not change gender presentation. " +
          "Do not change hairstyle or hair colour. " +
          "Do not change clothing. " +
          "Do not crop the hairstyle. " +
          "Do not crop the top of the head. " +
          "Do not zoom excessively close to the face. " +
          "Do not add unrelated accessories. " +
          "Do not add another person. " +
          "Do not create multiple versions. " +
          "Do not create a collage. " +
          "Do not create a character sheet. " +
          "Do not add text or watermark. " +

          "Generate exactly ONE centered Q-character portrait on a " +
          "simple clean background.",


        // ========================================
        // REFERENCE PHOTO
        // ========================================

        image_urls: [
          body.image_url
        ],


        // ========================================
        // HIGH IDENTITY / INPUT PRESERVATION
        // ========================================

        input_fidelity: "high",


        // ========================================
        // OUTPUT
        // ========================================

        image_size: "1024x1024",

        quality: "high",

        background: "opaque",

        num_images: 1,

        output_format: "png",

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
