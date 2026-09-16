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
      // STAGYLIGHT MY Q PROMPT
      //
      // TARGET:
      // 70% IDENTITY / 30% Q STYLIZATION
      // ==========================================

      const falBody = {

        prompt:

          "Transform the supplied photograph into ONE cute illustrated " +
          "STAGYLIGHT Q-version portrait of the SAME PERSON. " +

          "IMPORTANT: facial identity and recognizability are the highest " +
          "priority. The finished Q-character must clearly look like the " +
          "person in the supplied reference photograph, not like a generic " +
          "anime or chibi character. " +


          "FACE IDENTITY: " +

          "Preserve the person's distinctive facial structure and proportions. " +
          "Preserve the original face shape, forehead proportions, jawline, " +
          "cheek shape, eyebrow shape, eyebrow position, natural eye shape, " +
          "eye spacing, nose shape, nose proportions, mouth shape, lip shape " +
          "and overall facial geometry. " +

          "The illustrated face should feel like a simplified illustrated " +
          "version of the real face rather than a newly designed cartoon face. " +


          "EYES: " +

          "Keep the person's natural eye shape and spacing recognizable. " +
          "The eyes may be only slightly enlarged for Q-character styling. " +
          "Do not create extremely large round anime eyes. " +
          "Do not replace the person's natural eye shape with generic " +
          "chibi eyes. " +


          "EXPRESSION: " +

          "Give the person a friendly, warm and natural expression with " +
          "a gentle natural smile. Keep the expression believable and " +
          "consistent with the person's facial structure. " +
          "Do not create an exaggerated doll-like smile. " +


          "GENDER PRESENTATION: " +

          "Preserve the person's visible gender presentation exactly as " +
          "shown in the reference photograph. Do not feminize or masculinize " +
          "the person. " +

          "Do not add makeup, lipstick, eyeliner, eyeshadow, prominent " +
          "eyelashes, cosmetic blush or beauty styling unless those features " +
          "are clearly present in the original photograph. " +


          "HAIR: " +

          "Preserve the hairstyle from the reference photograph. " +
          "Keep the same haircut, hair length, hair direction, hairline " +
          "and hair colour. Do not invent longer hair or redesign the hairstyle. " +


          "CLOTHING: " +

          "Preserve the clothing visible in the reference photograph. " +
          "Keep the same clothing type and main colours. Do not replace the " +
          "clothing with a costume, suit, school uniform, dress, skirt or " +
          "unrelated outfit. " +


          "Q-VERSION STYLE: " +

          "Apply moderate cute Q-character proportions. Use a moderately " +
          "larger head and smaller upper body while keeping the person's " +
          "facial identity clearly recognizable. " +

          "Use clean polished digital illustration, soft natural facial " +
          "rendering and a friendly modern character design. " +

          "The result should look cute and approachable, but identity " +
          "accuracy is more important than maximum cuteness. " +

          "Aim approximately for 70 percent recognizable real-person " +
          "identity and 30 percent cute Q-character stylization. " +


          "DO NOT: " +

          "Do not create a generic anime face. " +
          "Do not create a generic doll face. " +
          "Do not dramatically enlarge the eyes. " +
          "Do not dramatically change the face shape. " +
          "Do not change ethnicity or skin tone. " +
          "Do not change gender presentation. " +
          "Do not change hairstyle. " +
          "Do not change clothing. " +
          "Do not add unrelated accessories. " +
          "Do not generate multiple characters. " +
          "Do not create a collage or character sheet. " +


          "Generate exactly ONE person, ONE portrait and ONE Q-character " +
          "on a simple clean background.",


        image_url: body.image_url,

        num_images: 1,

        aspect_ratio: "1:1",

        output_format: "jpeg",

        safety_tolerance: "2"
      };


      // ==========================================
      // SEND TO FAL.AI
      // ==========================================

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
