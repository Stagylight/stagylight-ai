export default {
  async fetch(request, env) {
    return new Response("STAGYLIGHT AI Worker is working!", {
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
