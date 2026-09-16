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

          "Create ONE cute STAGYLIGHT Q-version portrait of the " +
          "EXACT SAME PERSON shown in the reference photograph. " +

          "The number one priority is facial identity. The finished " +
          "character must be immediately recognizable as the same real " +
          "person in the reference image. " +

          "Preserve the person's distinctive face shape, forehead, " +
          "jawline, cheeks, eyebrows, natural eye shape, eye spacing, " +
          "nose shape, mouth shape, lips, skin tone and recognizable " +
          "facial proportions. " +

          "Do not replace these features with a generic anime face, " +
          "generic doll face or generic chibi face. " +

          "Keep the person's natural eye shape recognizable. The eyes " +
          "may be slightly larger and friendlier for Q styling, but do " +
          "not make them dramatically larger or rounder. " +

          "Give the character a warm, happy and friendly natural smile. " +
          "The expression should look cute and approachable without " +
          "changing the person's identity. " +

          "Preserve the visible gender presentation of the reference " +
          "person exactly. Do not feminize or masculinize the person. " +

          "Do not add lipstick, makeup, eyeliner, eyeshadow, prominent " +
          "eyelashes or cosmetic blush unless clearly present in the " +
          "reference photograph. " +

          "Preserve the exact hairstyle, haircut, hair length, hairline, " +
          "hair direction and hair colour shown in the reference image. " +

          "Preserve the clothing type and main clothing colours shown " +
          "in the reference image. " +

          "Apply only moderate Q-version stylization: a slightly larger " +
          "head, slightly smaller body and polished cute illustration " +
          "finish. Keep the face substantially closer to the real person " +
          "than to a generic cartoon character. " +

          "Target approximately 80 percent recognizable real-person " +
          "identity and 20 percent cute Q-character stylization. " +

          "Generate exactly ONE person and ONE portrait. " +
          "No collage, no character sheet, no alternate versions, " +
          "no multiple poses and no additional people. " +

          "Use a clean simple background.",


        reference_image_url: body.image_url,

        image_size: "square_hd",

        num_inference_steps: 28,

        guidance_scale: 4,

        true_cfg: 1,

        // Maximum supported identity weight
        id_weight: 1.0,

        negative_prompt:
          "different person, wrong identity, identity loss, " +
          "generic anime face, generic chibi face, generic doll face, " +
          "different face shape, different eyes, different nose, " +
          "different mouth, different jawline, gender change, " +
          "different hairstyle, long hair, different hair colour, " +
          "different clothing, dress, skirt, school uniform, " +
          "heavy makeup, lipstick, eyeliner, eyeshadow, " +
          "prominent eyelashes, exaggerated blush, " +
          "huge anime eyes, oversized round eyes, " +
          "multiple people, multiple characters, character sheet, " +
          "collage, multiple poses, text, watermark, signature, " +
          "blurry, low quality, deformed face, extra limbs",

        enable_safety_checker: true
      };


      // ==========================================
      // SEND TO FAL.AI FLUX PuLID
      // ==========================================

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
