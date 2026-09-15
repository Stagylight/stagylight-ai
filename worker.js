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
      const response = await fetch(
        "https://queue.fal.run/fal-ai/flux/dev",
        {
          method: "POST",
          headers: {
            "Authorization": `Key ${env.FAL_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const data = await response.text();

      return new Response(data, {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type":
            response.headers.get("Content-Type") || "application/json"
        }
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
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
