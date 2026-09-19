export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return new Response(
        "STAGYLIGHT AI Worker is working!",
        {
          headers: {
            ...cors,
            "Content-Type": "text/plain"
          }
        }
      );
    }

    try {

      const body = await request.json();


      // =========================================================
      // STAGYLIGHT ACCOUNT DATABASE TEST
      // =========================================================

      if (body.action === "account_test") {

        requireDatabase(env);

        const users =
          await env.STAGYLIGHT_DB
            .prepare(
              "SELECT COUNT(*) AS total FROM users"
            )
            .first();

        const sessions =
          await env.STAGYLIGHT_DB
            .prepare(
              "SELECT COUNT(*) AS total FROM sessions"
            )
            .first();

        return json(
          {
            ok: true,
            service: "STAGYLIGHT Accounts",
            database: "connected",
            users: Number(users?.total || 0),
            sessions: Number(sessions?.total || 0),
            message:
              "STAGYLIGHT account database is connected."
          },
          200,
          cors
        );
      }


      // =========================================================
      // SIGN UP
      // =========================================================

      if (body.action === "signup") {

        requireDatabase(env);

        const email =
          normalizeEmail(body.email);

        const username =
          normalizeUsername(body.username);

        const displayName =
          cleanText(body.display_name, 80);

        const password =
          String(body.password || "");

        if (!isValidEmail(email)) {
          return json(
            {
              ok: false,
              error: "Please enter a valid email address."
            },
            400,
            cors
          );
        }

        if (!isValidUsername(username)) {
          return json(
            {
              ok: false,
              error:
                "Username must be 3-30 characters and use only letters, numbers, dots or underscores."
            },
            400,
            cors
          );
        }

        if (!displayName) {
          return json(
            {
              ok: false,
              error: "Display name is required."
            },
            400,
            cors
          );
        }

        if (password.length < 8) {
          return json(
            {
              ok: false,
              error:
                "Password must contain at least 8 characters."
            },
            400,
            cors
          );
        }

        if (password.length > 128) {
          return json(
            {
              ok: false,
              error: "Password is too long."
            },
            400,
            cors
          );
        }


        const existing =
          await env.STAGYLIGHT_DB
            .prepare(
              `SELECT id, email, username
               FROM users
               WHERE lower(email) = ?
                  OR lower(username) = ?
               LIMIT 1`
            )
            .bind(
              email,
              username
            )
            .first();


        if (existing) {

          if (
            String(existing.email || "")
              .toLowerCase() === email
          ) {
            return json(
              {
                ok: false,
                error:
                  "An account already exists with this email."
              },
              409,
              cors
            );
          }

          return json(
            {
              ok: false,
              error:
                "This username is already taken."
            },
            409,
            cors
          );
        }


        const userId =
          crypto.randomUUID();

        const passwordHash =
          await hashPassword(password);

        const now =
          new Date().toISOString();


        try {

          await env.STAGYLIGHT_DB
            .prepare(
              `INSERT INTO users (
                id,
                email,
                username,
                display_name,
                password_hash,
                auth_provider,
                provider_user_id,
                profile_image_url,
                bio,
                location,
                languages,
                availability,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              userId,
              email,
              username,
              displayName,
              passwordHash,
              "email",
              null,
              cleanNullableText(
                body.profile_image_url,
                2000
              ),
              cleanNullableText(
                body.bio,
                500
              ),
              cleanNullableText(
                body.location,
                120
              ),
              cleanNullableText(
                body.languages,
                300
              ),
              cleanNullableText(
                body.availability,
                120
              ),
              now,
              now
            )
            .run();

        } catch (e) {

          if (
            String(e.message || "")
              .toLowerCase()
              .includes("unique")
          ) {
            return json(
              {
                ok: false,
                error:
                  "Email or username is already registered."
              },
              409,
              cors
            );
          }

          throw e;
        }


        const session =
          await createSession(
            env,
            userId
          );


        return json(
          {
            ok: true,
            message:
              "STAGYLIGHT account created.",
            token: session.token,
            expires_at:
              session.expires_at,
            user: {
              id: userId,
              email,
              username,
              display_name: displayName,
              auth_provider: "email",
              profile_image_url:
                cleanNullableText(
                  body.profile_image_url,
                  2000
                ),
              bio:
                cleanNullableText(
                  body.bio,
                  500
                ),
              location:
                cleanNullableText(
                  body.location,
                  120
                ),
              languages:
                cleanNullableText(
                  body.languages,
                  300
                ),
              availability:
                cleanNullableText(
                  body.availability,
                  120
                ),
              created_at: now,
              updated_at: now
            }
          },
          201,
          cors
        );
      }


      // =========================================================
      // LOGIN
      // =========================================================

      if (body.action === "login") {

        requireDatabase(env);

        const login =
          String(
            body.login ||
            body.email ||
            body.username ||
            ""
          )
            .trim()
            .toLowerCase();

        const password =
          String(body.password || "");


        if (!login || !password) {
          return json(
            {
              ok: false,
              error:
                "Email/username and password are required."
            },
            400,
            cors
          );
        }


        const user =
          await env.STAGYLIGHT_DB
            .prepare(
              `SELECT *
               FROM users
               WHERE lower(email) = ?
                  OR lower(username) = ?
               LIMIT 1`
            )
            .bind(
              login,
              login
            )
            .first();


        if (
          !user ||
          !user.password_hash ||
          user.auth_provider !== "email"
        ) {
          return json(
            {
              ok: false,
              error:
                "Incorrect email/username or password."
            },
            401,
            cors
          );
        }


        const valid =
          await verifyPassword(
            password,
            user.password_hash
          );


        if (!valid) {
          return json(
            {
              ok: false,
              error:
                "Incorrect email/username or password."
            },
            401,
            cors
          );
        }


        const session =
          await createSession(
            env,
            user.id
          );


        return json(
          {
            ok: true,
            message: "Login successful.",
            token: session.token,
            expires_at:
              session.expires_at,
            user: publicUser(user)
          },
          200,
          cors
        );
      }


      // =========================================================
      // CHECK SESSION
      // =========================================================

      if (
        body.action === "check_session" ||
        body.action === "get_account"
      ) {

        requireDatabase(env);

        const session =
          await authenticateSession(
            env,
            body.token
          );


        if (!session) {
          return json(
            {
              ok: false,
              authenticated: false,
              error:
                "Session is invalid or expired."
            },
            401,
            cors
          );
        }


        return json(
          {
            ok: true,
            authenticated: true,
            user:
              publicUser(session.user),
            expires_at:
              session.expires_at
          },
          200,
          cors
        );
      }


      // =========================================================
      // UPDATE PROFILE
      // =========================================================

      if (body.action === "update_profile") {

        requireDatabase(env);

        const session =
          await authenticateSession(
            env,
            body.token
          );


        if (!session) {
          return json(
            {
              ok: false,
              error:
                "Session is invalid or expired."
            },
            401,
            cors
          );
        }


        const current =
          session.user;

        const displayName =
          body.display_name === undefined
            ? current.display_name
            : cleanText(
                body.display_name,
                80
              );

        if (!displayName) {
          return json(
            {
              ok: false,
              error:
                "Display name cannot be empty."
            },
            400,
            cors
          );
        }


        let username =
          current.username;

        if (body.username !== undefined) {

          username =
            normalizeUsername(
              body.username
            );

          if (!isValidUsername(username)) {
            return json(
              {
                ok: false,
                error:
                  "Username must be 3-30 characters and use only letters, numbers, dots or underscores."
              },
              400,
              cors
            );
          }


          const taken =
            await env.STAGYLIGHT_DB
              .prepare(
                `SELECT id
                 FROM users
                 WHERE lower(username) = ?
                   AND id <> ?
                 LIMIT 1`
              )
              .bind(
                username,
                current.id
              )
              .first();


          if (taken) {
            return json(
              {
                ok: false,
                error:
                  "This username is already taken."
              },
              409,
              cors
            );
          }
        }


        const profileImage =
          body.profile_image_url === undefined
            ? current.profile_image_url
            : cleanNullableText(
                body.profile_image_url,
                2000
              );

        const bio =
          body.bio === undefined
            ? current.bio
            : cleanNullableText(
                body.bio,
                500
              );

        const location =
          body.location === undefined
            ? current.location
            : cleanNullableText(
                body.location,
                120
              );

        const languages =
          body.languages === undefined
            ? current.languages
            : cleanNullableText(
                body.languages,
                300
              );

        const availability =
          body.availability === undefined
            ? current.availability
            : cleanNullableText(
                body.availability,
                120
              );

        const now =
          new Date().toISOString();


        await env.STAGYLIGHT_DB
          .prepare(
            `UPDATE users
             SET username = ?,
                 display_name = ?,
                 profile_image_url = ?,
                 bio = ?,
                 location = ?,
                 languages = ?,
                 availability = ?,
                 updated_at = ?
             WHERE id = ?`
          )
          .bind(
            username,
            displayName,
            profileImage,
            bio,
            location,
            languages,
            availability,
            now,
            current.id
          )
          .run();


        const updated =
          await env.STAGYLIGHT_DB
            .prepare(
              `SELECT *
               FROM users
               WHERE id = ?
               LIMIT 1`
            )
            .bind(current.id)
            .first();


        return json(
          {
            ok: true,
            message:
              "Profile updated.",
            user: publicUser(updated)
          },
          200,
          cors
        );
      }


      // =========================================================
      // LOGOUT
      // =========================================================

      if (body.action === "logout") {

        requireDatabase(env);

        const token =
          String(body.token || "");

        if (token) {

          const tokenHash =
            await sha256Hex(token);

          await env.STAGYLIGHT_DB
            .prepare(
              `DELETE FROM sessions
               WHERE token_hash = ?`
            )
            .bind(tokenHash)
            .run();
        }


        return json(
          {
            ok: true,
            message: "Logged out."
          },
          200,
          cors
        );
      }


      // =========================================================
      // STAGYLIGHT AI HEALTH CHECK
      // =========================================================

      if (body.action === "health_check") {

        return json(
          {
            ok: true,
            service: "STAGYLIGHT AI",
            status: "connected",
            message:
              "STAGYLIGHT AI Worker is connected and responding.",
            fal_called: false
          },
          200,
          cors
        );
      }


      // =========================================================
      // Q-STICKER GENERATION
      // =========================================================

      if (body.action === "create_sticker") {

        if (!body.image_url) {
          return json(
            {
              ok: false,
              error:
                "Missing Master Q image."
            },
            400,
            cors
          );
        }

        let stickerType =
          String(
            body.sticker_type || ""
          )
            .trim()
            .toLowerCase();


        if (stickerType === "happy") {
          stickerType = "haha";
        }


        const supportedStickers = [
          "haha",
          "love",
          "sad",
          "angry",
          "like",
          "celebrate"
        ];


        if (
          !supportedStickers.includes(
            stickerType
          )
        ) {
          return json(
            {
              ok: false,
              error:
                "Unsupported sticker type."
            },
            400,
            cors
          );
        }


        const result =
          await submitFal(
            env.FAL_KEY,
            body.image_url,
            getStickerPrompt(
              stickerType
            )
          );


        if (
          !result.ok ||
          !result.data
        ) {

          console.error(
            "Q-STICKER FAL ERROR",
            JSON.stringify({
              sticker_type:
                stickerType,
              fal_status:
                result.status,
              fal_response:
                result.text
            })
          );

          return json(
            {
              ok: false,
              error:
                "Sticker generation submission failed.",
              fal_status:
                result.status,
              details:
                result.text
            },
            500,
            cors
          );
        }


        return json(
          {
            ok: true,
            message:
              "Q-Sticker submitted.",
            sticker_type:
              stickerType,
            request_id:
              result.data.request_id ||
              null,
            status_url:
              result.data.status_url ||
              null,
            response_url:
              result.data.response_url ||
              null
          },
          200,
          cors
        );
      }


      // =========================================================
      // DURABLE OBJECT TEST
      // =========================================================

      if (body.action === "job_test") {

        return forward(
          await controller(
            env,
            "stagylight-main-ai-controller"
          ).fetch(
            internalRequest(
              "job_test",
              body
            )
          ),
          cors
        );
      }


      // =========================================================
      // CREATE TWO-STAGE Q JOB
      // =========================================================

      if (body.action === "create_job") {

        const jobId =
          crypto.randomUUID();

        return forward(
          await controller(
            env,
            jobId
          ).fetch(
            internalRequest(
              "create_job",
              {
                job_id: jobId,
                image_url:
                  body.image_url ||
                  null
              }
            )
          ),
          cors
        );
      }


      // =========================================================
      // START / ADVANCE / GET JOB
      // =========================================================

      if (
        body.action === "start_job" ||
        body.action === "advance_job" ||
        body.action === "get_job"
      ) {

        if (!body.job_id) {
          return json(
            {
              ok: false,
              error:
                "Missing job_id."
            },
            400,
            cors
          );
        }

        if (
          body.action ===
            "start_job" &&
          !body.image_url
        ) {
          return json(
            {
              ok: false,
              error:
                "Missing image_url."
            },
            400,
            cors
          );
        }

        return forward(
          await controller(
            env,
            body.job_id
          ).fetch(
            internalRequest(
              body.action,
              body
            )
          ),
          cors
        );
      }


      // =========================================================
      // FAL STATUS / RESULT PROXY
      // =========================================================

      if (
        body.action === "status" &&
        body.url
      ) {

        const r =
          await fetch(
            body.url,
            {
              headers: {
                "Authorization":
                  `Key ${env.FAL_KEY}`
              }
            }
          );

        return new Response(
          await r.text(),
          {
            status: r.status,
            headers: {
              ...cors,
              "Content-Type":
                r.headers.get(
                  "Content-Type"
                ) ||
                "application/json"
            }
          }
        );
      }


      // =========================================================
      // LEGACY SINGLE-STAGE ROUTE
      // =========================================================

      if (!body.image_url) {

        return json(
          {
            ok: false,
            error:
              "No reference image received."
          },
          400,
          cors
        );
      }

      const r =
        await submitFal(
          env.FAL_KEY,
          body.image_url,
          getIdentityPrompt()
        );

      return new Response(
        r.text,
        {
          status: r.status,
          headers: {
            ...cors,
            "Content-Type":
              "application/json"
          }
        }
      );

    } catch (e) {

      return json(
        {
          ok: false,
          error:
            e.message ||
            "Unexpected server error."
        },
        500,
        cors
      );
    }
  }
};


// ===============================================================
// DURABLE OBJECT
// ===============================================================

export class AIJobController {

  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {

    try {

      const body =
        await request.json();


      if (
        body.action ===
        "job_test"
      ) {

        return controllerJson({
          ok: true,
          controller:
            "AIJobController",
          message:
            "STAGYLIGHT two-stage AI controller ready",
          fal_called: false
        });
      }


      if (
        body.action ===
        "create_job"
      ) {

        const now =
          new Date().toISOString();

        const job = {

          job_id:
            body.job_id,

          status: "created",

          stage: "waiting",

          source_image:
            body.image_url ||
            null,

          stage_1_status:
            "not_started",
          stage_1_request_id:
            null,
          stage_1_status_url:
            null,
          stage_1_response_url:
            null,
          stage_1_image:
            null,

          stage_2_status:
            "not_started",
          stage_2_request_id:
            null,
          stage_2_status_url:
            null,
          stage_2_response_url:
            null,
          stage_2_image:
            null,

          final_image: null,

          error: null,

          created_at: now,
          updated_at: now,

          fal_called: false
        };

        await this.ctx.storage.put(
          "job",
          job
        );

        return controllerJson({
          ok: true,
          message:
            "STAGYLIGHT AI job created",
          job
        });
      }


      if (
        body.action ===
        "get_job"
      ) {

        const job =
          await this.ctx.storage.get(
            "job"
          );

        if (!job) {
          return controllerJson(
            {
              ok: false,
              error:
                "Job not found."
            },
            404
          );
        }

        return controllerJson({
          ok: true,
          job
        });
      }


      if (
        body.action ===
        "start_job"
      ) {

        let job =
          await this.ctx.storage.get(
            "job"
          );

        if (!job) {
          return controllerJson(
            {
              ok: false,
              error:
                "Job not found."
            },
            404
          );
        }

        if (!body.image_url) {
          return controllerJson(
            {
              ok: false,
              error:
                "Missing image_url."
            },
            400
          );
        }

        if (
          job.stage_1_status !==
          "not_started"
        ) {
          return controllerJson({
            ok: true,
            message:
              "Stage 1 already started.",
            job
          });
        }

        job.source_image =
          body.image_url;

        job.status =
          "processing";

        job.stage =
          "stage_1";

        job.stage_1_status =
          "submitting";

        await saveJob(
          this.ctx,
          job
        );

        const result =
          await submitFal(
            this.env.FAL_KEY,
            body.image_url,
            getIdentityPrompt()
          );

        if (
          !result.ok ||
          !result.data
        ) {

          job.status =
            "error";

          job.stage_1_status =
            "error";

          job.error =
            result.text ||
            "Stage 1 submission failed.";

          await saveJob(
            this.ctx,
            job
          );

          return controllerJson(
            {
              ok: false,
              error:
                job.error,
              job
            },
            500
          );
        }

        job.stage_1_status =
          "submitted";

        job.stage_1_request_id =
          result.data.request_id ||
          null;

        job.stage_1_status_url =
          result.data.status_url ||
          null;

        job.stage_1_response_url =
          result.data.response_url ||
          null;

        job.fal_called =
          true;

        await saveJob(
          this.ctx,
          job
        );

        return controllerJson({
          ok: true,
          message:
            "Stage 1 submitted.",
          job
        });
      }


      if (
        body.action ===
        "advance_job"
      ) {

        let job =
          await this.ctx.storage.get(
            "job"
          );

        if (!job) {
          return controllerJson(
            {
              ok: false,
              error:
                "Job not found."
            },
            404
          );
        }

        if (
          job.status ===
          "completed"
        ) {
          return controllerJson({
            ok: true,
            message:
              "Q Master is ready.",
            job
          });
        }

        if (
          job.status ===
          "error"
        ) {
          return controllerJson(
            {
              ok: false,
              error:
                job.error ||
                "AI job failed.",
              job
            },
            500
          );
        }


        if (
          job.stage_1_status ===
            "submitted" ||
          job.stage_1_status ===
            "processing"
        ) {

          const check =
            await checkFal(
              job.stage_1_status_url,
              job.stage_1_response_url,
              this.env.FAL_KEY
            );

          if (
            check.state ===
            "processing"
          ) {

            job.stage_1_status =
              "processing";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson({
              ok: true,
              message:
                "Stage 1 is processing.",
              job
            });
          }

          if (
            check.state ===
            "error"
          ) {

            job.status =
              "error";

            job.stage_1_status =
              "error";

            job.error =
              check.error;

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  check.error,
                job
              },
              500
            );
          }

          const stage1Image =
            extractImage(
              check.data
            );

          if (!stage1Image) {

            job.status =
              "error";

            job.stage_1_status =
              "error";

            job.error =
              "Stage 1 completed but no image was returned.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  job.error,
                job
              },
              500
            );
          }

          job.stage_1_status =
            "completed";

          job.stage_1_image =
            stage1Image;

          job.stage =
            "stage_2";

          await saveJob(
            this.ctx,
            job
          );
        }


        if (
          job.stage_1_status ===
            "completed" &&
          job.stage_2_status ===
            "not_started"
        ) {

          job.stage_2_status =
            "submitting";

          job.stage =
            "stage_2";

          await saveJob(
            this.ctx,
            job
          );

          const result =
            await submitFal(
              this.env.FAL_KEY,
              job.stage_1_image,
              getQMasterPrompt()
            );

          if (
            !result.ok ||
            !result.data
          ) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              result.text ||
              "Stage 2 submission failed.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  job.error,
                job
              },
              500
            );
          }

          job.stage_2_status =
            "submitted";

          job.stage_2_request_id =
            result.data.request_id ||
            null;

          job.stage_2_status_url =
            result.data.status_url ||
            null;

          job.stage_2_response_url =
            result.data.response_url ||
            null;

          await saveJob(
            this.ctx,
            job
          );

          return controllerJson({
            ok: true,
            message:
              "Stage 1 complete. Stage 2 submitted.",
            job
          });
        }


        if (
          job.stage_2_status ===
            "submitted" ||
          job.stage_2_status ===
            "processing"
        ) {

          const check =
            await checkFal(
              job.stage_2_status_url,
              job.stage_2_response_url,
              this.env.FAL_KEY
            );

          if (
            check.state ===
            "processing"
          ) {

            job.stage_2_status =
              "processing";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson({
              ok: true,
              message:
                "Stage 2 is processing.",
              job
            });
          }

          if (
            check.state ===
            "error"
          ) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              check.error;

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  check.error,
                job
              },
              500
            );
          }

          const finalImage =
            extractImage(
              check.data
            );

          if (!finalImage) {

            job.status =
              "error";

            job.stage_2_status =
              "error";

            job.error =
              "Stage 2 completed but no image was returned.";

            await saveJob(
              this.ctx,
              job
            );

            return controllerJson(
              {
                ok: false,
                error:
                  job.error,
                job
              },
              500
            );
          }

          job.stage_2_status =
            "completed";

          job.stage_2_image =
            finalImage;

          job.final_image =
            finalImage;

          job.status =
            "completed";

          job.stage =
            "completed";

          job.error =
            null;

          await saveJob(
            this.ctx,
            job
          );

          return controllerJson({
            ok: true,
            message:
              "STAGYLIGHT Q Master completed.",
            job
          });
        }

        return controllerJson({
          ok: true,
          message:
            "Job is waiting.",
          job
        });
      }


      return controllerJson(
        {
          ok: false,
          error:
            "Unknown controller action."
        },
        400
      );

    } catch (e) {

      return controllerJson(
        {
          ok: false,
          error:
            e.message
        },
        500
      );
    }
  }
}


// ===============================================================
// ACCOUNT HELPERS
// ===============================================================

function requireDatabase(env) {

  if (!env.STAGYLIGHT_DB) {
    throw new Error(
      "STAGYLIGHT_DB binding is unavailable."
    );
  }
}


function normalizeEmail(value) {

  return String(value || "")
    .trim()
    .toLowerCase();
}


function normalizeUsername(value) {

  return String(value || "")
    .trim()
    .toLowerCase();
}


function isValidEmail(email) {

  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  );
}


function isValidUsername(username) {

  return (
    username.length >= 3 &&
    username.length <= 30 &&
    /^[a-z0-9._]+$/.test(
      username
    )
  );
}


function cleanText(
  value,
  maxLength
) {

  return String(value || "")
    .trim()
    .slice(0, maxLength);
}


function cleanNullableText(
  value,
  maxLength
) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const cleaned =
    String(value)
      .trim()
      .slice(0, maxLength);

  return cleaned || null;
}


function publicUser(user) {

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name:
      user.display_name,
    auth_provider:
      user.auth_provider,
    profile_image_url:
      user.profile_image_url ||
      null,
    bio:
      user.bio || null,
    location:
      user.location || null,
    languages:
      user.languages || null,
    availability:
      user.availability || null,
    created_at:
      user.created_at,
    updated_at:
      user.updated_at
  };
}


// ===============================================================
// PASSWORD HASHING
// ===============================================================

const PASSWORD_ITERATIONS =
  100000;

async function hashPassword(
  password
) {

  const salt =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  const hash =
    await derivePassword(
      password,
      salt,
      PASSWORD_ITERATIONS
    );

  return [
    "pbkdf2_sha256",
    PASSWORD_ITERATIONS,
    bytesToBase64(salt),
    bytesToBase64(hash)
  ].join("$");
}


async function verifyPassword(
  password,
  stored
) {

  try {

    const parts =
      String(stored || "")
        .split("$");

    if (
      parts.length !== 4 ||
      parts[0] !==
        "pbkdf2_sha256"
    ) {
      return false;
    }

    const iterations =
      Number(parts[1]);

    if (
      !Number.isInteger(
        iterations
      ) ||
      iterations < 100000 ||
      iterations > 1000000
    ) {
      return false;
    }

    const salt =
      base64ToBytes(
        parts[2]
      );

    const expected =
      base64ToBytes(
        parts[3]
      );

    const actual =
      await derivePassword(
        password,
        salt,
        iterations
      );

    return constantTimeEqual(
      actual,
      expected
    );

  } catch (_) {

    return false;
  }
}


async function derivePassword(
  password,
  salt,
  iterations
) {

  const encoder =
    new TextEncoder();

  const keyMaterial =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      {
        name: "PBKDF2"
      },
      false,
      [
        "deriveBits"
      ]
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations
      },
      keyMaterial,
      256
    );

  return new Uint8Array(bits);
}


function constantTimeEqual(
  a,
  b
) {

  if (
    !(a instanceof Uint8Array) ||
    !(b instanceof Uint8Array)
  ) {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    difference |=
      a[i] ^ b[i];
  }

  return difference === 0;
}


// ===============================================================
// SESSION MANAGEMENT
// ===============================================================

async function createSession(
  env,
  userId
) {

  const sessionId =
    crypto.randomUUID();

  const token =
    randomToken(32);

  const tokenHash =
    await sha256Hex(token);

  const createdAt =
    new Date();

  const expiresAt =
    new Date(
      createdAt.getTime() +
      30 *
      24 *
      60 *
      60 *
      1000
    );

  await env.STAGYLIGHT_DB
    .prepare(
      `INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      sessionId,
      userId,
      tokenHash,
      createdAt.toISOString(),
      expiresAt.toISOString()
    )
    .run();

  return {
    token,
    expires_at:
      expiresAt.toISOString()
  };
}


async function authenticateSession(
  env,
  rawToken
) {

  const token =
    String(rawToken || "");

  if (!token) {
    return null;
  }

  const tokenHash =
    await sha256Hex(token);

  const row =
    await env.STAGYLIGHT_DB
      .prepare(
        `SELECT
          s.id AS session_id,
          s.user_id AS session_user_id,
          s.expires_at AS session_expires_at,
          u.*
         FROM sessions s
         JOIN users u
           ON u.id = s.user_id
         WHERE s.token_hash = ?
         LIMIT 1`
      )
      .bind(tokenHash)
      .first();

  if (!row) {
    return null;
  }

  const expires =
    Date.parse(
      row.session_expires_at
    );

  if (
    !Number.isFinite(expires) ||
    expires <= Date.now()
  ) {

    await env.STAGYLIGHT_DB
      .prepare(
        `DELETE FROM sessions
         WHERE id = ?`
      )
      .bind(
        row.session_id
      )
      .run();

    return null;
  }

  const user = {
    id: row.id,
    email: row.email,
    username: row.username,
    display_name:
      row.display_name,
    password_hash:
      row.password_hash,
    auth_provider:
      row.auth_provider,
    provider_user_id:
      row.provider_user_id,
    profile_image_url:
      row.profile_image_url,
    bio: row.bio,
    location: row.location,
    languages: row.languages,
    availability:
      row.availability,
    created_at:
      row.created_at,
    updated_at:
      row.updated_at
  };

  return {
    user,
    expires_at:
      row.session_expires_at
  };
}


function randomToken(
  byteLength
) {

  const bytes =
    crypto.getRandomValues(
      new Uint8Array(
        byteLength
      )
    );

  return bytesToBase64Url(
    bytes
  );
}


async function sha256Hex(
  value
) {

  const bytes =
    new TextEncoder()
      .encode(value);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      bytes
    );

  return Array.from(
    new Uint8Array(digest)
  )
    .map(
      b =>
        b
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


function bytesToBase64(
  bytes
) {

  let binary = "";

  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    binary +=
      String.fromCharCode(
        bytes[i]
      );
  }

  return btoa(binary);
}


function base64ToBytes(
  value
) {

  const binary =
    atob(value);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}


function bytesToBase64Url(
  bytes
) {

  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


// ===============================================================
// FAL SUBMIT
// ===============================================================

async function submitFal(
  falKey,
  imageUrl,
  prompt
) {

  const r =
    await fetch(
      "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
      {
        method: "POST",

        headers: {
          "Authorization":
            `Key ${falKey}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          prompt,

          image_urls: [
            imageUrl
          ],

          input_fidelity:
            "high",

          image_size:
            "1024x1024",

          quality: "high",

          background:
            "opaque",

          num_images: 1,

          output_format:
            "png",

          sync_mode: false
        })
      }
    );

  const text =
    await r.text();

  let data = null;

  try {
    data =
      JSON.parse(text);
  } catch (_) {}

  return {
    ok: r.ok,
    status: r.status,
    text,
    data
  };
}


// ===============================================================
// FAL STATUS + RESULT
// ===============================================================

async function checkFal(
  statusUrl,
  responseUrl,
  falKey
) {

  if (!statusUrl) {
    return {
      state: "error",
      error:
        "Missing fal.ai status URL."
    };
  }

  const r =
    await fetch(
      statusUrl,
      {
        headers: {
          "Authorization":
            `Key ${falKey}`
        }
      }
    );

  const text =
    await r.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch (_) {
    return {
      state: "error",
      error:
        "Invalid fal.ai status response."
    };
  }

  if (!r.ok) {
    return {
      state: "error",
      error:
        data?.detail ||
        data?.error ||
        text
    };
  }

  const status =
    String(
      data.status || ""
    ).toUpperCase();

  if (
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS"
  ) {
    return {
      state: "processing"
    };
  }

  if (
    status !== "COMPLETED"
  ) {
    return {
      state: "processing"
    };
  }

  if (!responseUrl) {
    return {
      state: "error",
      error:
        "fal.ai completed but response URL is missing."
    };
  }

  const result =
    await fetch(
      responseUrl,
      {
        headers: {
          "Authorization":
            `Key ${falKey}`
        }
      }
    );

  const resultText =
    await result.text();

  let resultData;

  try {
    resultData =
      JSON.parse(
        resultText
      );
  } catch (_) {
    return {
      state: "error",
      error:
        "Invalid fal.ai result response."
    };
  }

  if (!result.ok) {
    return {
      state: "error",
      error:
        resultData?.detail ||
        resultData?.error ||
        resultText
    };
  }

  return {
    state: "completed",
    data: resultData
  };
}


// ===============================================================
// STAGE 1
// ===============================================================

function getIdentityPrompt() {

  return `

Create ONE premium illustrated portrait of the EXACT SAME ADULT
PERSON shown in the supplied reference photograph.

This is STAGYLIGHT IDENTITY MASTER — STAGE 1.

This is NOT the final Q character.

IDENTITY IS THE HIGHEST PRIORITY.

The result must immediately look like the SAME PERSON.

Preserve the person's actual:

- face length and width
- forehead
- cheek structure
- jawline
- chin
- eyebrow shape
- natural eye shape and size
- eye spacing
- eyelids
- nose shape, width and length
- mouth shape
- lip proportions
- skin tone
- distinctive facial characteristics
- adult age appearance
- visible gender presentation

Do NOT substitute generic anime or cartoon facial features.

Do NOT beautify the person into somebody else.

Preserve the hairstyle extremely carefully:

- haircut
- hairline
- length
- fringe
- direction
- side shape
- top volume
- texture
- colour distribution

If the source crops the very highest part of the hair,
naturally reconstruct the continuation of the SAME hairstyle.

Preserve visible clothing and accessories.

Do NOT add makeup, lipstick, eyeliner, eyeshadow,
artificial eyelashes, blush or pink cheeks unless clearly
present in the source.

Keep mature adult facial proportions.

NO baby face.
NO child appearance.
NO huge anime eyes.
NO excessively round cheeks.
NO tiny nose.
NO tiny chin.

Create a polished premium digital illustration with mild
stylization only.

COMPOSITION:

Show the complete hairstyle, head, face, chin, neck,
shoulders and upper chest.

Leave approximately 10 to 15 percent clean background above
the highest point of the hairstyle.

Nothing important may touch or leave the canvas.

Center the person on a clean neutral background.

If illustration style conflicts with recognizable identity,
PRESERVE IDENTITY.

Generate exactly ONE square portrait.

`;
}


// ===============================================================
// STAGE 2
// ===============================================================

function getQMasterPrompt() {

  return `

Transform the supplied STAGYLIGHT IDENTITY MASTER into ONE
premium ADULT Q CHARACTER of the EXACT SAME PERSON.

ABSOLUTE PRIORITY:

PRESERVE THE FACE.

The supplied Identity Master already contains the correct face.

DO NOT redesign, reinterpret, beautify, simplify or reconstruct
the face into a typical chibi or anime face.

The final character must be unmistakably the SAME ADULT PERSON.

FACE — ALMOST NO GEOMETRIC CHANGE:

Preserve:

- exact face length-to-width ratio
- forehead height and width
- cheek width and placement
- jawline and jaw angle
- chin length, width and shape
- eyebrow shape, thickness and position
- exact natural eye shape
- exact eye opening and size
- iris size relative to eye
- eye spacing
- eyelids
- eyebrow-to-eye distance
- nose bridge, length and tip
- nostril width
- mouth width and shape
- cupid's bow
- lip thickness
- nose-to-mouth distance
- lower-face length
- skin tone
- distinctive facial characteristics
- adult age appearance
- visible gender presentation

DO NOT round or widen the face.

DO NOT shorten the lower face.

DO NOT enlarge the forehead.

DO NOT shrink the nose or chin.

The FACE itself should receive MINIMAL Q distortion.

EYES — STRICT LOCK:

DO NOT enlarge, widen or round the eyes.

DO NOT create anime, doll or childlike eyes.

Keep the same natural eye anatomy.

ADULT — STRICT LOCK:

NO baby face.
NO toddler.
NO child.
NO baby-faced chibi.
NO inflated cheeks.
NO tiny nose.
NO tiny chin.
NO extremely round head.
NO youthful doll face.

Q STYLE:

Create the Q feeling mainly through:

- polished cute illustration rendering
- slightly larger head relative to body
- moderately compact shoulders and upper body
- clean Q-avatar silhouette
- friendly expression
- premium sticker presentation

Do NOT enlarge facial features to create cuteness.

The face stays recognizable and mature.

Use mild Q proportions only.

HAIR:

Preserve the SAME hairstyle, hairline, haircut, fringe,
direction, top volume, side shape, texture, length and
colour distribution.

CLOTHING AND ACCESSORIES:

Preserve the same clothing, colours and visible accessories.

NO MAKEUP:

Do NOT add cosmetic blush, pink cheeks, lipstick,
eyeliner, eyeshadow, artificial eyelashes or beauty makeup.

EXPRESSION:

Pleasant, friendly and confident adult expression.

Use a small natural smile.

STYLE:

Premium modern STAGYLIGHT Q illustration.

Cute but mature.
Identity-first.
Clean digital artwork.
Refined facial detail.
Smooth controlled shading.
Professional avatar/sticker quality.

The FACE should remain more structurally realistic than
a normal chibi character.

COMPOSITION:

Show entire hairstyle, full head, complete face, chin,
neck, shoulders and upper body.

Leave approximately 10 to 15 percent clean background
above the hairstyle.

Center on a clean neutral background.

No text.
No watermark.
No logo.
No extra person.
No collage.
No multiple versions.

FINAL PRIORITY:

1. SAME FACE
2. SAME ADULT PERSON
3. NATURAL ORIGINAL EYES
4. ORIGINAL FACE LENGTH / JAW / CHIN
5. ORIGINAL NOSE AND MOUTH
6. SAME HAIRSTYLE
7. MILD Q PROPORTIONS
8. SAME CLOTHING / ACCESSORIES
9. NO MAKEUP OR BLUSH
10. PREMIUM STAGYLIGHT QUALITY

IF CUTENESS CONFLICTS WITH IDENTITY:

IDENTITY MUST WIN.

KEEP THE EXISTING FACE AND Q-STYLIZE THE CHARACTER AROUND IT.

Generate exactly ONE square Adult Q Master.

`;
}


// ===============================================================
// Q-STICKER PROMPTS
// ===============================================================

function getStickerPrompt(type) {

  const reactions = {

    haha: `
HAPPY / LAUGHING REACTION 😂

Create a genuinely joyful and happy laughing expression.

Use a natural open smile or laugh, cheerful eyes and a playful
upper-body reaction.

The character should look strongly amused, energetic and happy.

Do not create huge anime eyes.
Do not distort the mouth beyond recognition.
Do not change the person's identity.

The result must clearly communicate HAPPY / LAUGHTER without text.
`,

    love: `
LOVE / AFFECTION REACTION ❤️

Create a sweet, warm and affectionate reaction.

Use a gentle happy smile.

The character should form a clear small HEART gesture using
the hands near the chest.

The pose should communicate love, affection and appreciation.

Keep the face mature and natural.

Do NOT add romantic makeup, lipstick, blush or exaggerated
pink cheeks.

The result must clearly communicate LOVE without text.
`,

    sad: `
SAD / UPSET REACTION 😭

Create a clearly sad and emotionally upset expression.

The mouth may turn slightly downward.

The eyes should look naturally sad and emotional.

Small natural tears are allowed so the emotion is immediately
understandable.

Do NOT enlarge the eyes.
Do NOT create giant cartoon eyes.
Do NOT distort the face.
Do NOT turn the person into a different character.

Keep the sadness believable while preserving identity.

The result must clearly communicate SADNESS without text.
`,

    angry: `
ANGRY / FRUSTRATED REACTION 😡

Create a clearly angry and frustrated expression.

Use naturally lowered or slightly furrowed eyebrows,
a serious tense mouth and a confident irritated pose.

The character may use a naturally clenched fist near the body,
but the pose must remain non-violent and suitable for a social
reaction sticker.

Do NOT make the face monstrous.
Do NOT add glowing eyes.
Do NOT add flames.
Do NOT distort the face.
Do NOT change the person's identity.

Keep the same adult face, hairstyle and clothing.

The result must clearly communicate ANGER / FRUSTRATION
without text.
`,

    like: `
LIKE / APPROVAL REACTION 👍

Create a positive, confident approval reaction.

The character should display ONE clear thumbs-up gesture.

Use a friendly natural smile and confident happy expression.

The thumb and hand must be anatomically clear and remain
completely inside the frame.

Do NOT exaggerate the eyes or facial proportions.
Do NOT change the person's identity.

The result must clearly communicate LIKE / APPROVAL
without text.
`,

    celebrate: `
CELEBRATE / EXCITED REACTION 🎉

Create a joyful, energetic celebration reaction.

The character should look excited and genuinely happy.

Use an enthusiastic smile and celebratory upper-body pose.

The character may raise both hands in celebration.

Add a SMALL amount of tasteful celebratory confetti around
the character.

Keep the face fully visible and recognizable.

Do NOT cover the face with confetti.
Do NOT add written text.
Do NOT redesign the clothing.
Do NOT distort the person's identity.

The result must clearly communicate CELEBRATION / SUCCESS
without text.
`
  };


  const reaction =
    reactions[type] ||
    reactions.haha;


  return `

Create exactly ONE premium STAGYLIGHT Q reaction sticker using
the supplied MASTER Q image.

THE SUPPLIED IMAGE IS THE CHARACTER MASTER.

ABSOLUTE RULE:

KEEP THE EXACT SAME CHARACTER.

DO NOT invent a new Q character.
DO NOT redesign the face.
DO NOT reinterpret the person's identity.
DO NOT change the character's age.

============================================================
IDENTITY LOCK
============================================================

The underlying facial structure must remain the SAME even when
the emotion changes the facial muscles.

Preserve:

- same recognizable face
- same face length-to-width ratio
- same forehead
- same cheek structure
- same jawline
- same chin
- same eyebrows
- same eye placement
- same natural eye anatomy
- same nose shape and size
- same mouth identity
- same lower-face proportions
- same skin tone
- same adult appearance
- same distinctive facial characteristics

EMOTION MAY CHANGE FACIAL MUSCLES.

EMOTION MUST NOT CHANGE FACIAL IDENTITY.

Do NOT make the face wider or rounder.

Do NOT shorten the face.

Do NOT shrink the nose.

Do NOT shrink the chin.

Do NOT make the person younger.

============================================================
HAIR LOCK
============================================================

Preserve exactly the same:

- hairstyle
- hairline
- fringe
- swept direction
- top volume
- side shape
- length
- texture
- hair colour distribution

Do NOT redesign the hairstyle.

============================================================
CLOTHING + ACCESSORY LOCK
============================================================

Keep exactly the same main clothing and visible accessories
as the supplied Master Q.

Do NOT redesign the outfit merely to match the reaction.

============================================================
Q STYLE LOCK
============================================================

Match the supplied Master Q's existing illustration style.

Maintain:

- same Q-character design language
- same level of facial realism
- same adult Q proportions
- same rendering quality
- same smooth controlled shading
- same premium STAGYLIGHT visual identity

Do NOT convert the character into a generic anime,
manga or baby chibi character.

============================================================
REACTION
============================================================

${reaction}

============================================================
STRICT EYE RULE
============================================================

Expression may naturally change the eyelids.

However:

DO NOT make the eyes larger than the Master Q.
DO NOT make them rounder to create cuteness.
DO NOT replace them with generic anime eyes.
DO NOT create doll eyes.

============================================================
ADULT LOCK
============================================================

The character must clearly remain the same adult.

NO baby face.
NO toddler proportions.
NO child appearance.
NO inflated cheeks.
NO tiny nose.
NO tiny chin.
NO youthful doll face.

============================================================
NO MAKEUP
============================================================

Do NOT add:

- cosmetic blush
- artificial pink cheeks
- lipstick
- eyeliner
- eyeshadow
- artificial eyelashes
- beauty makeup

============================================================
COMPOSITION
============================================================

Show the entire hairstyle and head.

Do NOT crop the top of the hair.

Show enough neck, shoulders, arms and upper body to clearly
display the reaction gesture when needed.

Keep all important hands and gestures completely inside
the frame.

Center the character.

Use a clean simple neutral background suitable for a reaction
sticker.

No written text.
No letters.
No watermark.
No logo.
No extra people.
No collage.
No multiple versions.

============================================================
FINAL PRIORITY
============================================================

1. EXACT SAME MASTER Q CHARACTER
2. SAME FACE AND FACIAL STRUCTURE
3. SAME ADULT IDENTITY
4. SAME HAIRSTYLE
5. SAME CLOTHING AND ACCESSORIES
6. CORRECT REACTION / POSE
7. SAME Q ART STYLE
8. NATURAL FACIAL EXPRESSION
9. NO UNWANTED MAKEUP
10. PREMIUM STAGYLIGHT QUALITY

IF EMOTION CONFLICTS WITH IDENTITY:

IDENTITY MUST WIN.

CHANGE THE EMOTION, NOT THE PERSON.

Generate exactly ONE square reaction Q-Sticker.

`;
}


// ===============================================================
// AI HELPERS
// ===============================================================

function controller(
  env,
  name
) {

  if (
    !env.AI_JOB_CONTROLLER
  ) {
    throw new Error(
      "AI_JOB_CONTROLLER binding is unavailable."
    );
  }

  const id =
    env.AI_JOB_CONTROLLER
      .idFromName(name);

  return env
    .AI_JOB_CONTROLLER
    .get(id);
}


function internalRequest(
  action,
  data
) {

  return new Request(
    "https://stagylight.internal/" +
      action,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        ...data,
        action
      })
    }
  );
}


async function saveJob(
  ctx,
  job
) {

  job.updated_at =
    new Date()
      .toISOString();

  await ctx.storage.put(
    "job",
    job
  );
}


function extractImage(data) {

  if (
    data &&
    Array.isArray(
      data.images
    ) &&
    data.images.length > 0 &&
    data.images[0]?.url
  ) {
    return data.images[0].url;
  }

  return null;
}


function json(
  data,
  status,
  cors
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...cors,
        "Content-Type":
          "application/json"
      }
    }
  );
}


function controllerJson(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}


async function forward(
  response,
  cors
) {

  return new Response(
    await response.text(),
    {
      status:
        response.status,

      headers: {
        ...cors,
        "Content-Type":
          "application/json"
      }
    }
  );
}

