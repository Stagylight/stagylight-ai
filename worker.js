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
      // ACCOUNT DATABASE TEST
      // =========================================================

      if (body.action === "account_test") {

        requireDatabase(env);

        const users = await env.STAGYLIGHT_DB
          .prepare("SELECT COUNT(*) AS total FROM users")
          .first();

        const sessions = await env.STAGYLIGHT_DB
          .prepare("SELECT COUNT(*) AS total FROM sessions")
          .first();

        return json({
          ok: true,
          service: "STAGYLIGHT Accounts",
          database: "connected",
          users: Number(users?.total || 0),
          sessions: Number(sessions?.total || 0),
          message: "STAGYLIGHT account database is connected."
        }, 200, cors);
      }


      // =========================================================
      // SIGNUP
      // =========================================================

      if (body.action === "signup") {

        requireDatabase(env);

        const email = normalizeEmail(body.email);
        const username = normalizeUsername(body.username);
        const displayName = cleanText(body.display_name, 80);
        const password = String(body.password || "");

        if (!isValidEmail(email)) {
          return json({
            ok: false,
            error: "Please enter a valid email address."
          }, 400, cors);
        }

        if (!isValidUsername(username)) {
          return json({
            ok: false,
            error: "Username must be 3-30 characters and use only letters, numbers, dots or underscores."
          }, 400, cors);
        }

        if (!displayName) {
          return json({
            ok: false,
            error: "Display name is required."
          }, 400, cors);
        }

        if (password.length < 8) {
          return json({
            ok: false,
            error: "Password must contain at least 8 characters."
          }, 400, cors);
        }

        if (password.length > 128) {
          return json({
            ok: false,
            error: "Password is too long."
          }, 400, cors);
        }

        const existing = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT id, email, username
            FROM users
            WHERE lower(email) = ?
               OR lower(username) = ?
            LIMIT 1
          `)
          .bind(email, username)
          .first();

        if (existing) {

          if (
            String(existing.email || "").toLowerCase() === email
          ) {
            return json({
              ok: false,
              error: "An account already exists with this email."
            }, 409, cors);
          }

          return json({
            ok: false,
            error: "This username is already taken."
          }, 409, cors);
        }

        const userId = crypto.randomUUID();
        const passwordHash = await hashPassword(password);
        const now = new Date().toISOString();

        try {

          await env.STAGYLIGHT_DB
            .prepare(`
              INSERT INTO users (
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
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
              userId,
              email,
              username,
              displayName,
              passwordHash,
              "email",
              null,
              cleanNullableText(body.profile_image_url, 2000),
              cleanNullableText(body.bio, 500),
              cleanNullableText(body.location, 120),
              cleanNullableText(body.languages, 300),
              cleanNullableText(body.availability, 120),
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
            return json({
              ok: false,
              error: "Email or username is already registered."
            }, 409, cors);
          }

          throw e;
        }

        const session = await createSession(env, userId);

        return json({
          ok: true,
          message: "STAGYLIGHT account created.",
          token: session.token,
          expires_at: session.expires_at,
          user: {
            id: userId,
            email,
            username,
            display_name: displayName,
            auth_provider: "email",
            profile_image_url:
              cleanNullableText(body.profile_image_url, 2000),
            bio:
              cleanNullableText(body.bio, 500),
            location:
              cleanNullableText(body.location, 120),
            languages:
              cleanNullableText(body.languages, 300),
            availability:
              cleanNullableText(body.availability, 120),
            created_at: now,
            updated_at: now
          }
        }, 201, cors);
      }


      // =========================================================
      // LOGIN
      // =========================================================

      if (body.action === "login") {

        requireDatabase(env);

        const login = String(
          body.login ||
          body.email ||
          body.username ||
          ""
        )
          .trim()
          .toLowerCase();

        const password = String(body.password || "");

        if (!login || !password) {
          return json({
            ok: false,
            error: "Email/username and password are required."
          }, 400, cors);
        }

        const user = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT *
            FROM users
            WHERE lower(email) = ?
               OR lower(username) = ?
            LIMIT 1
          `)
          .bind(login, login)
          .first();

        if (
          !user ||
          !user.password_hash ||
          user.auth_provider !== "email"
        ) {
          return json({
            ok: false,
            error: "Incorrect email/username or password."
          }, 401, cors);
        }

        const valid = await verifyPassword(
          password,
          user.password_hash
        );

        if (!valid) {
          return json({
            ok: false,
            error: "Incorrect email/username or password."
          }, 401, cors);
        }

        const session = await createSession(env, user.id);

        return json({
          ok: true,
          message: "Login successful.",
          token: session.token,
          expires_at: session.expires_at,
          user: publicUser(user)
        }, 200, cors);
      }


      // =========================================================
      // CHECK SESSION
      // =========================================================

      if (
        body.action === "check_session" ||
        body.action === "get_account"
      ) {

        requireDatabase(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            authenticated: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        return json({
          ok: true,
          authenticated: true,
          user: publicUser(session.user),
          expires_at: session.expires_at
        }, 200, cors);
      }


      // =========================================================
      // UPDATE PROFILE
      // =========================================================

      if (body.action === "update_profile") {

        requireDatabase(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const current = session.user;

        const displayName =
          body.display_name === undefined
            ? current.display_name
            : cleanText(body.display_name, 80);

        if (!displayName) {
          return json({
            ok: false,
            error: "Display name cannot be empty."
          }, 400, cors);
        }

        let username = current.username;

        if (body.username !== undefined) {

          username = normalizeUsername(body.username);

          if (!isValidUsername(username)) {
            return json({
              ok: false,
              error: "Username must be 3-30 characters and use only letters, numbers, dots or underscores."
            }, 400, cors);
          }

          const taken = await env.STAGYLIGHT_DB
            .prepare(`
              SELECT id
              FROM users
              WHERE lower(username) = ?
                AND id <> ?
              LIMIT 1
            `)
            .bind(username, current.id)
            .first();

          if (taken) {
            return json({
              ok: false,
              error: "This username is already taken."
            }, 409, cors);
          }
        }

        const profileImage =
          body.profile_image_url === undefined
            ? current.profile_image_url
            : cleanNullableText(body.profile_image_url, 2000);

        const bio =
          body.bio === undefined
            ? current.bio
            : cleanNullableText(body.bio, 500);

        const location =
          body.location === undefined
            ? current.location
            : cleanNullableText(body.location, 120);

        const languages =
          body.languages === undefined
            ? current.languages
            : cleanNullableText(body.languages, 300);

        const availability =
          body.availability === undefined
            ? current.availability
            : cleanNullableText(body.availability, 120);

        const now = new Date().toISOString();

        await env.STAGYLIGHT_DB
          .prepare(`
            UPDATE users
            SET username = ?,
                display_name = ?,
                profile_image_url = ?,
                bio = ?,
                location = ?,
                languages = ?,
                availability = ?,
                updated_at = ?
            WHERE id = ?
          `)
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

        const updated = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT *
            FROM users
            WHERE id = ?
            LIMIT 1
          `)
          .bind(current.id)
          .first();

        return json({
          ok: true,
          message: "Profile updated.",
          user: publicUser(updated)
        }, 200, cors);
      }


      // =========================================================
      // LOGOUT
      // =========================================================

      if (body.action === "logout") {

        requireDatabase(env);

        const token = String(body.token || "");

        if (token) {

          const tokenHash = await sha256Hex(token);

          await env.STAGYLIGHT_DB
            .prepare(`
              DELETE FROM sessions
              WHERE token_hash = ?
            `)
            .bind(tokenHash)
            .run();
        }

        return json({
          ok: true,
          message: "Logged out."
        }, 200, cors);
      }


      // =========================================================
      // SEARCH USERS
      // =========================================================

      if (body.action === "search_users") {

        requireDatabase(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const query = String(
          body.query ||
          body.search ||
          ""
        )
          .trim()
          .toLowerCase()
          .replace(/^@+/, "")
          .slice(0, 80);

        let limit = Number(body.limit || 50);

        if (!Number.isFinite(limit) || limit < 1) {
          limit = 50;
        }

        limit = Math.min(Math.floor(limit), 100);

        let result;

        if (query) {

          const pattern = "%" + query + "%";

          result = await env.STAGYLIGHT_DB
            .prepare(`
              SELECT
                id,
                username,
                display_name,
                profile_image_url,
                bio,
                location,
                languages,
                availability,
                created_at,
                updated_at
              FROM users
              WHERE id <> ?
                AND (
                  lower(username) LIKE ?
                  OR lower(display_name) LIKE ?
                )
              ORDER BY
                CASE
                  WHEN lower(username) = ? THEN 0
                  WHEN lower(display_name) = ? THEN 1
                  WHEN lower(username) LIKE ? THEN 2
                  ELSE 3
                END,
                lower(display_name) ASC,
                lower(username) ASC
              LIMIT ?
            `)
            .bind(
              session.user.id,
              pattern,
              pattern,
              query,
              query,
              query + "%",
              limit
            )
            .all();

        } else {

          result = await env.STAGYLIGHT_DB
            .prepare(`
              SELECT
                id,
                username,
                display_name,
                profile_image_url,
                bio,
                location,
                languages,
                availability,
                created_at,
                updated_at
              FROM users
              WHERE id <> ?
              ORDER BY created_at DESC
              LIMIT ?
            `)
            .bind(session.user.id, limit)
            .all();
        }

        const users = (result.results || []).map(user => ({
          id: user.id,
          username: user.username || "",
          display_name:
            user.display_name ||
            user.username ||
            "STAGYLIGHT User",
          profile_image_url:
            user.profile_image_url || null,
          bio: user.bio || null,
          location: user.location || null,
          languages: user.languages || null,
          availability: user.availability || null,
          created_at: user.created_at,
          updated_at: user.updated_at
        }));

        return json({
          ok: true,
          users,
          total: users.length
        }, 200, cors);
      }


      // =========================================================
      // SOCIAL SETUP
      // =========================================================

      if (body.action === "social_setup") {

        requireDatabase(env);

        await ensureSocialTables(env);
        await ensureMessageTables(env);

        return json({
          ok: true,
          message: "STAGYLIGHT social database is ready."
        }, 200, cors);
      }


      // =========================================================
      // FOLLOW USER
      // =========================================================

      if (body.action === "follow_user") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "User not found."
          }, 404, cors);
        }

        if (target.id === session.user.id) {
          return json({
            ok: false,
            error: "You cannot follow yourself."
          }, 400, cors);
        }

        const existing = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT id
            FROM social_follows
            WHERE follower_user_id = ?
              AND following_user_id = ?
            LIMIT 1
          `)
          .bind(
            session.user.id,
            target.id
          )
          .first();

        let created = false;

        if (!existing) {

          const now = new Date().toISOString();

          await env.STAGYLIGHT_DB
            .prepare(`
              INSERT INTO social_follows (
                id,
                follower_user_id,
                following_user_id,
                created_at
              )
              VALUES (?, ?, ?, ?)
            `)
            .bind(
              crypto.randomUUID(),
              session.user.id,
              target.id,
              now
            )
            .run();

          await createSocialNotification(env, {
            targetUserId: target.id,
            actorUserId: session.user.id,
            type: "follow",
            postId: null,
            message:
              `${session.user.display_name || session.user.username} followed you.`,
            createdAt: now
          });

          created = true;
        }

        const counts = await getFollowCounts(
          env,
          target.id
        );

        return json({
          ok: true,
          following: true,
          created,
          target_user: publicUser(target),
          followers: counts.followers,
          following_count: counts.following
        }, 200, cors);
      }


      // =========================================================
      // UNFOLLOW USER
      // =========================================================

      if (body.action === "unfollow_user") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "User not found."
          }, 404, cors);
        }

        await env.STAGYLIGHT_DB
          .prepare(`
            DELETE FROM social_follows
            WHERE follower_user_id = ?
              AND following_user_id = ?
          `)
          .bind(
            session.user.id,
            target.id
          )
          .run();

        const counts = await getFollowCounts(
          env,
          target.id
        );

        return json({
          ok: true,
          following: false,
          target_user: publicUser(target),
          followers: counts.followers,
          following_count: counts.following
        }, 200, cors);
      }


      // =========================================================
      // FOLLOW STATUS
      // =========================================================

      if (body.action === "get_follow_status") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "User not found."
          }, 404, cors);
        }

        const relation = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT id
            FROM social_follows
            WHERE follower_user_id = ?
              AND following_user_id = ?
            LIMIT 1
          `)
          .bind(
            session.user.id,
            target.id
          )
          .first();

        const counts = await getFollowCounts(
          env,
          target.id
        );

        return json({
          ok: true,
          following: Boolean(relation),
          is_self:
            target.id === session.user.id,
          followers: counts.followers,
          following_count: counts.following,
          target_user: publicUser(target)
        }, 200, cors);
      }


      // =========================================================
      // FOLLOW COUNTS
      // =========================================================

      if (body.action === "get_follow_counts") {

        requireDatabase(env);
        await ensureSocialTables(env);

        let target = null;

        if (
          body.user_id ||
          body.target_user_id ||
          body.username ||
          body.target_username
        ) {
          target = await findTargetUser(env, body);
        } else {

          const session = await authenticateSession(
            env,
            body.token
          );

          if (session) {
            target = session.user;
          }
        }

        if (!target) {
          return json({
            ok: false,
            error: "User not found."
          }, 404, cors);
        }

        const counts = await getFollowCounts(
          env,
          target.id
        );

        return json({
          ok: true,
          user_id: target.id,
          username: target.username,
          followers: counts.followers,
          following: counts.following
        }, 200, cors);
      }


      // =========================================================
      // CREATE NOTIFICATION
      // =========================================================

      if (body.action === "create_notification") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const type = String(
          body.type ||
          body.notification_type ||
          ""
        )
          .trim()
          .toLowerCase();

        const supportedTypes = [
          "like",
          "comment",
          "share",
          "message"
        ];

        if (!supportedTypes.includes(type)) {
          return json({
            ok: false,
            error: "Unsupported notification type."
          }, 400, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "Notification target user not found."
          }, 404, cors);
        }

        if (target.id === session.user.id) {
          return json({
            ok: true,
            skipped: true,
            message: "Self notification skipped."
          }, 200, cors);
        }

        const postId = cleanNullableText(
          body.post_id ||
          body.postId,
          300
        );

        const message =
          cleanNullableText(body.message, 500) ||
          defaultNotificationMessage(
            type,
            session.user
          );

        const notification =
          await createSocialNotification(env, {
            targetUserId: target.id,
            actorUserId: session.user.id,
            type,
            postId,
            message,
            createdAt: new Date().toISOString()
          });

        return json({
          ok: true,
          message: "Notification created.",
          notification
        }, 201, cors);
      }


      // =========================================================
      // GET NOTIFICATIONS
      // =========================================================

      if (body.action === "get_notifications") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        let limit = Number(body.limit || 100);

        if (!Number.isFinite(limit) || limit < 1) {
          limit = 100;
        }

        limit = Math.min(Math.floor(limit), 200);

        const result = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT
              n.id,
              n.target_user_id,
              n.actor_user_id,
              n.type,
              n.post_id,
              n.message,
              n.is_read,
              n.created_at,
              u.username AS actor_username,
              u.display_name AS actor_display_name,
              u.profile_image_url AS actor_profile_image_url
            FROM social_notifications n
            LEFT JOIN users u
              ON u.id = n.actor_user_id
            WHERE n.target_user_id = ?
            ORDER BY n.created_at DESC
            LIMIT ?
          `)
          .bind(
            session.user.id,
            limit
          )
          .all();

        const notifications =
          (result.results || []).map(row => ({
            id: row.id,
            target_user_id: row.target_user_id,
            actor_user_id: row.actor_user_id,
            actor_username:
              row.actor_username || "",
            actor_display_name:
              row.actor_display_name ||
              row.actor_username ||
              "STAGYLIGHT User",
            actor_profile_image_url:
              row.actor_profile_image_url || null,
            type: row.type,
            post_id: row.post_id || null,
            message: row.message || "",
            is_read:
              Number(row.is_read || 0) === 1,
            created_at: row.created_at
          }));

        const unread =
          notifications.filter(
            item => !item.is_read
          ).length;

        return json({
          ok: true,
          notifications,
          total: notifications.length,
          unread
        }, 200, cors);
      }


      // =========================================================
      // NOTIFICATION COUNT
      // =========================================================

      if (body.action === "get_notification_count") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const row = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT COUNT(*) AS total
            FROM social_notifications
            WHERE target_user_id = ?
              AND is_read = 0
          `)
          .bind(session.user.id)
          .first();

        return json({
          ok: true,
          unread: Number(row?.total || 0)
        }, 200, cors);
      }


      // =========================================================
      // MARK ONE NOTIFICATION READ
      // =========================================================

      if (body.action === "mark_notification_read") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const notificationId = cleanText(
          body.notification_id ||
          body.id,
          200
        );

        if (!notificationId) {
          return json({
            ok: false,
            error: "Missing notification_id."
          }, 400, cors);
        }

        await env.STAGYLIGHT_DB
          .prepare(`
            UPDATE social_notifications
            SET is_read = 1
            WHERE id = ?
              AND target_user_id = ?
          `)
          .bind(
            notificationId,
            session.user.id
          )
          .run();

        return json({
          ok: true,
          message: "Notification marked as read."
        }, 200, cors);
      }


      // =========================================================
      // MARK ALL NOTIFICATIONS READ
      // =========================================================

      if (body.action === "mark_notifications_read") {

        requireDatabase(env);
        await ensureSocialTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        await env.STAGYLIGHT_DB
          .prepare(`
            UPDATE social_notifications
            SET is_read = 1
            WHERE target_user_id = ?
              AND is_read = 0
          `)
          .bind(session.user.id)
          .run();

        return json({
          ok: true,
          unread: 0,
          message: "Notifications marked as read."
        }, 200, cors);
      }


      // =========================================================
      // SEND MESSAGE
      // =========================================================

      if (body.action === "send_message") {

        requireDatabase(env);
        await ensureSocialTables(env);
        await ensureMessageTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "Message recipient not found."
          }, 404, cors);
        }

        if (target.id === session.user.id) {
          return json({
            ok: false,
            error: "You cannot message yourself."
          }, 400, cors);
        }

        let messageType = String(
          body.message_type ||
          body.messageType ||
          body.type ||
          "text"
        )
          .trim()
          .slice(0, 40);

        if (!messageType) {
          messageType = "text";
        }

        const textContent = cleanNullableText(
          body.text ||
          body.message ||
          body.text_content,
          5000
        );

        let payloadJson = null;

        if (
          body.payload !== undefined &&
          body.payload !== null
        ) {
          try {
            payloadJson =
              JSON.stringify(body.payload)
                .slice(0, 50000);
          } catch (_) {}
        } else if (
          body.payload_json !== undefined &&
          body.payload_json !== null
        ) {
          payloadJson =
            String(body.payload_json)
              .slice(0, 50000);
        }

        if (
          messageType.toLowerCase() === "text" &&
          !textContent
        ) {
          return json({
            ok: false,
            error: "Message cannot be empty."
          }, 400, cors);
        }

        if (!textContent && !payloadJson) {
          return json({
            ok: false,
            error: "Message content is required."
          }, 400, cors);
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await env.STAGYLIGHT_DB
          .prepare(`
            INSERT INTO social_messages (
              id,
              sender_user_id,
              recipient_user_id,
              message_type,
              text_content,
              payload_json,
              is_read,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
          `)
          .bind(
            id,
            session.user.id,
            target.id,
            messageType,
            textContent,
            payloadJson,
            now
          )
          .run();

        await createSocialNotification(env, {
          targetUserId: target.id,
          actorUserId: session.user.id,
          type: "message",
          postId: null,
          message:
            `${session.user.display_name || session.user.username} sent you a message.`,
          createdAt: now
        });

        return json({
          ok: true,
          message: "Message sent.",
          data: {
            id,
            sender_user_id: session.user.id,
            sender_username:
              session.user.username || "",
            sender_display_name:
              session.user.display_name ||
              session.user.username ||
              "STAGYLIGHT User",
            sender_profile_image_url:
              session.user.profile_image_url || null,
            recipient_user_id: target.id,
            recipient_username:
              target.username || "",
            recipient_display_name:
              target.display_name ||
              target.username ||
              "STAGYLIGHT User",
            recipient_profile_image_url:
              target.profile_image_url || null,
            message_type: messageType,
            text: textContent || "",
            text_content: textContent || "",
            payload: parsePayload(payloadJson),
            payload_json: payloadJson,
            is_read: false,
            created_at: now
          }
        }, 201, cors);
      }


      // =========================================================
      // GET MESSAGES
      // =========================================================

      if (body.action === "get_messages") {

        requireDatabase(env);
        await ensureMessageTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "Conversation user not found."
          }, 404, cors);
        }

        if (target.id === session.user.id) {
          return json({
            ok: false,
            error: "Invalid conversation."
          }, 400, cors);
        }

        let limit = Number(body.limit || 300);

        if (!Number.isFinite(limit) || limit < 1) {
          limit = 300;
        }

        limit = Math.min(Math.floor(limit), 500);

        const result = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT
              m.id,
              m.sender_user_id,
              m.recipient_user_id,
              m.message_type,
              m.text_content,
              m.payload_json,
              m.is_read,
              m.created_at,

              su.username AS sender_username,
              su.display_name AS sender_display_name,
              su.profile_image_url AS sender_profile_image_url,

              ru.username AS recipient_username,
              ru.display_name AS recipient_display_name,
              ru.profile_image_url AS recipient_profile_image_url

            FROM social_messages m

            LEFT JOIN users su
              ON su.id = m.sender_user_id

            LEFT JOIN users ru
              ON ru.id = m.recipient_user_id

            WHERE
              (
                m.sender_user_id = ?
                AND m.recipient_user_id = ?
              )
              OR
              (
                m.sender_user_id = ?
                AND m.recipient_user_id = ?
              )

            ORDER BY m.created_at ASC
            LIMIT ?
          `)
          .bind(
            session.user.id,
            target.id,
            target.id,
            session.user.id,
            limit
          )
          .all();

        const messages =
          (result.results || []).map(
            normalizeMessageRow
          );

        return json({
          ok: true,
          target_user: publicUser(target),
          messages,
          total: messages.length
        }, 200, cors);
      }


      // =========================================================
      // GET CONVERSATIONS
      // =========================================================

      if (body.action === "get_conversations") {

        requireDatabase(env);
        await ensureMessageTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const result = await env.STAGYLIGHT_DB
          .prepare(`
            SELECT
              m.id,
              m.sender_user_id,
              m.recipient_user_id,
              m.message_type,
              m.text_content,
              m.payload_json,
              m.is_read,
              m.created_at,

              su.username AS sender_username,
              su.display_name AS sender_display_name,
              su.profile_image_url AS sender_profile_image_url,
              su.availability AS sender_availability,

              ru.username AS recipient_username,
              ru.display_name AS recipient_display_name,
              ru.profile_image_url AS recipient_profile_image_url,
              ru.availability AS recipient_availability

            FROM social_messages m

            LEFT JOIN users su
              ON su.id = m.sender_user_id

            LEFT JOIN users ru
              ON ru.id = m.recipient_user_id

            WHERE
              m.sender_user_id = ?
              OR m.recipient_user_id = ?

            ORDER BY m.created_at DESC
            LIMIT 1000
          `)
          .bind(
            session.user.id,
            session.user.id
          )
          .all();

        const rows = result.results || [];
        const map = {};

        for (const row of rows) {

          const sentByMe =
            row.sender_user_id === session.user.id;

          const otherId =
            sentByMe
              ? row.recipient_user_id
              : row.sender_user_id;

          if (!otherId) {
            continue;
          }

          if (!map[otherId]) {

            const username =
              sentByMe
                ? row.recipient_username
                : row.sender_username;

            const displayName =
              sentByMe
                ? row.recipient_display_name
                : row.sender_display_name;

            const avatar =
              sentByMe
                ? row.recipient_profile_image_url
                : row.sender_profile_image_url;

            const availability =
              sentByMe
                ? row.recipient_availability
                : row.sender_availability;

            map[otherId] = {
              user_id: otherId,
              id: otherId,
              username: username || "",
              name:
                displayName ||
                username ||
                "STAGYLIGHT User",
              display_name:
                displayName ||
                username ||
                "STAGYLIGHT User",
              avatar: avatar || null,
              profile_image_url: avatar || null,
              status: availability || "",
              availability: availability || "",
              preview: messagePreview(row),
              last_message:
                messagePreview(row),
              last_message_at: row.created_at,
              created_at: row.created_at,
              unread_count: 0
            };
          }

          if (
            row.recipient_user_id === session.user.id &&
            Number(row.is_read || 0) === 0
          ) {
            map[otherId].unread_count += 1;
          }
        }

        const conversations =
          Object.values(map).sort(
            (a, b) =>
              String(b.last_message_at || "")
                .localeCompare(
                  String(a.last_message_at || "")
                )
          );

        return json({
          ok: true,
          conversations,
          total: conversations.length
        }, 200, cors);
      }


      // =========================================================
      // MARK MESSAGES READ
      // =========================================================

      if (body.action === "mark_messages_read") {

        requireDatabase(env);
        await ensureMessageTables(env);

        const session = await authenticateSession(
          env,
          body.token
        );

        if (!session) {
          return json({
            ok: false,
            error: "Session is invalid or expired."
          }, 401, cors);
        }

        const target = await findTargetUser(env, body);

        if (!target) {
          return json({
            ok: false,
            error: "Conversation user not found."
          }, 404, cors);
        }

        await env.STAGYLIGHT_DB
          .prepare(`
            UPDATE social_messages
            SET is_read = 1
            WHERE recipient_user_id = ?
              AND sender_user_id = ?
              AND is_read = 0
          `)
          .bind(
            session.user.id,
            target.id
          )
          .run();

        return json({
          ok: true,
          unread: 0,
          message: "Messages marked as read."
        }, 200, cors);
      }


      // =========================================================
      // AI HEALTH CHECK
      // =========================================================

      if (body.action === "health_check") {

        return json({
          ok: true,
          service: "STAGYLIGHT AI",
          status: "connected",
          message:
            "STAGYLIGHT AI Worker is connected and responding.",
          fal_called: false
        }, 200, cors);
      }


      // =========================================================
      // Q-STICKER
      // =========================================================

      if (body.action === "create_sticker") {

        if (!body.image_url) {
          return json({
            ok: false,
            error: "Missing Master Q image."
          }, 400, cors);
        }

        let stickerType = String(
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

        if (!supportedStickers.includes(stickerType)) {
          return json({
            ok: false,
            error: "Unsupported sticker type."
          }, 400, cors);
        }

        const result = await submitFal(
          env.FAL_KEY,
          body.image_url,
          getStickerPrompt(stickerType),
          "medium"
        );

        if (!result.ok || !result.data) {

          console.error(
            "Q-STICKER FAL ERROR",
            JSON.stringify({
              sticker_type: stickerType,
              fal_status: result.status,
              fal_response: result.text
            })
          );

          return json({
            ok: false,
            error: "Sticker generation submission failed.",
            fal_status: result.status,
            details: result.text
          }, 500, cors);
        }

        return json({
          ok: true,
          message: "Q-Sticker submitted.",
          sticker_type: stickerType,
          request_id:
            result.data.request_id || null,
          status_url:
            result.data.status_url || null,
          response_url:
            result.data.response_url || null
        }, 200, cors);
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
            internalRequest("job_test", body)
          ),
          cors
        );
      }


      // =========================================================
      // CREATE AI JOB
      // =========================================================

      if (body.action === "create_job") {

        const jobId = crypto.randomUUID();

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
                  body.image_url || null
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
          return json({
            ok: false,
            error: "Missing job_id."
          }, 400, cors);
        }

        if (
          body.action === "start_job" &&
          !body.image_url
        ) {
          return json({
            ok: false,
            error: "Missing image_url."
          }, 400, cors);
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
      // FAL STATUS
      // =========================================================

      if (
        body.action === "status" &&
        body.url
      ) {

        const r = await fetch(
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
                r.headers.get("Content-Type") ||
                "application/json"
            }
          }
        );
      }


      // =========================================================
      // LEGACY AI ROUTE
      // =========================================================

      if (!body.image_url) {

        return json({
          ok: false,
          error: "No reference image received."
        }, 400, cors);
      }

      const r = await submitFal(
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
            "Content-Type": "application/json"
          }
        }
      );

    } catch (e) {

      return json({
        ok: false,
        error:
          e.message ||
          "Unexpected server error."
      }, 500, cors);
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

      const body = await request.json();

      if (body.action === "job_test") {

        return controllerJson({
          ok: true,
          controller: "AIJobController",
          message:
            "STAGYLIGHT two-stage AI controller ready",
          fal_called: false
        });
      }

      if (body.action === "create_job") {

        const now = new Date().toISOString();

        const job = {
          job_id: body.job_id,
          status: "created",
          stage: "waiting",
          source_image: body.image_url || null,
          stage_1_status: "not_started",
          stage_1_request_id: null,
          stage_1_status_url: null,
          stage_1_response_url: null,
          stage_1_image: null,
          stage_2_status: "not_started",
          stage_2_request_id: null,
          stage_2_status_url: null,
          stage_2_response_url: null,
          stage_2_image: null,
          final_image: null,
          error: null,
          created_at: now,
          updated_at: now,
          fal_called: false
        };

        await this.ctx.storage.put("job", job);

        return controllerJson({
          ok: true,
          message: "STAGYLIGHT AI job created",
          job
        });
      }

      if (body.action === "get_job") {

        const job =
          await this.ctx.storage.get("job");

        if (!job) {
          return controllerJson({
            ok: false,
            error: "Job not found."
          }, 404);
        }

        return controllerJson({
          ok: true,
          job
        });
      }

      if (body.action === "start_job") {

        let job =
          await this.ctx.storage.get("job");

        if (!job) {
          return controllerJson({
            ok: false,
            error: "Job not found."
          }, 404);
        }

        if (!body.image_url) {
          return controllerJson({
            ok: false,
            error: "Missing image_url."
          }, 400);
        }

        if (job.stage_1_status !== "not_started") {
          return controllerJson({
            ok: true,
            message: "Stage 1 already started.",
            job
          });
        }

        job.source_image = body.image_url;
        job.status = "processing";
        job.stage = "stage_1";
        job.stage_1_status = "submitting";

        await saveJob(this.ctx, job);

        const result = await submitFal(
          this.env.FAL_KEY,
          body.image_url,
          getIdentityPrompt()
        );

        if (!result.ok || !result.data) {

          job.status = "error";
          job.stage_1_status = "error";
          job.error =
            result.text ||
            "Stage 1 submission failed.";

          await saveJob(this.ctx, job);

          return controllerJson({
            ok: false,
            error: job.error,
            job
          }, 500);
        }

        job.stage_1_status = "submitted";
        job.stage_1_request_id =
          result.data.request_id || null;
        job.stage_1_status_url =
          result.data.status_url || null;
        job.stage_1_response_url =
          result.data.response_url || null;
        job.fal_called = true;

        await saveJob(this.ctx, job);

        return controllerJson({
          ok: true,
          message: "Stage 1 submitted.",
          job
        });
      }

      if (body.action === "advance_job") {

        let job =
          await this.ctx.storage.get("job");

        if (!job) {
          return controllerJson({
            ok: false,
            error: "Job not found."
          }, 404);
        }

        if (job.status === "completed") {
          return controllerJson({
            ok: true,
            message: "Q Master is ready.",
            job
          });
        }

        if (job.status === "error") {
          return controllerJson({
            ok: false,
            error:
              job.error ||
              "AI job failed.",
            job
          }, 500);
        }

        if (
          job.stage_1_status === "submitted" ||
          job.stage_1_status === "processing"
        ) {

          const check = await checkFal(
            job.stage_1_status_url,
            job.stage_1_response_url,
            this.env.FAL_KEY
          );

          if (check.state === "processing") {

            job.stage_1_status = "processing";
            await saveJob(this.ctx, job);

            return controllerJson({
              ok: true,
              message: "Stage 1 is processing.",
              job
            });
          }

          if (check.state === "error") {

            job.status = "error";
            job.stage_1_status = "error";
            job.error = check.error;

            await saveJob(this.ctx, job);

            return controllerJson({
              ok: false,
              error: check.error,
              job
            }, 500);
          }

          const stage1Image =
            extractImage(check.data);

          if (!stage1Image) {

            job.status = "error";
            job.stage_1_status = "error";
            job.error =
              "Stage 1 completed but no image was returned.";

            await saveJob(this.ctx, job);

            return controllerJson({
              ok: false,
              error: job.error,
              job
            }, 500);
          }

          job.stage_1_status = "completed";
          job.stage_1_image = stage1Image;
          job.stage = "stage_2";

          await saveJob(this.ctx, job);
        }

        if (
          job.stage_1_status === "completed" &&
          job.stage_2_status === "not_started"
        ) {

          job.stage_2_status = "submitting";
          job.stage = "stage_2";

          await saveJob(this.ctx, job);

          const result = await submitFal(
            this.env.FAL_KEY,
            job.stage_1_image,
            getQMasterPrompt()
          );

          if (!result.ok || !result.data) {

            job.status = "error";
            job.stage_2_status = "error";
            job.error =
              result.text ||
              "Stage 2 submission failed.";

            await saveJob(this.ctx, job);

            return controllerJson({
              ok: false,
              error: job.error,
              job
            }, 500);
          }

          job.stage_2_status = "submitted";
          job.stage_2_request_id =
            result.data.request_id || null;
          job.stage_2_status_url =
            result.data.status_url || null;
          job.stage_2_response_url =
            result.data.response_url || null;

          await saveJob(this.ctx, job);

          return controllerJson({
            ok: true,
            message:
              "Stage 1 complete. Stage 2 submitted.",
            job
          });
        }

        if (
          job.stage_2_status === "submitted" ||
          job.stage_2_status === "processing"
        ) {

          const check = await checkFal(
            job.stage_2_status_url,
            job.stage_2_response_url,
            this.env.FAL_KEY
          );

          if (check.state === "processing") {

            job.stage_2_status = "processing";
            await saveJob(this.ctx, job);

            return controllerJson({
              ok: true,
              message: "Stage 2 is processing.",
              job
            });
          }

          if (check.state === "error") {

            job.status = "error";
            job.stage_2_status = "error";
            job.error = check.error;

            await saveJob(this.ctx, job);

            return controllerJson({
              ok: false,
              error: check.error,
              job
            }, 500);
          }

          const finalImage =
            extractImage(check.data);

          if (!finalImage) {

            job.status = "error";
            job.stage_2_status = "error";
            job.error =
              "Stage 2 completed but no image was returned.";

            await saveJob(this.ctx, job);

            return controllerJson({
              ok: false,
              error: job.error,
              job
            }, 500);
          }

          job.stage_2_status = "completed";
          job.stage_2_image = finalImage;
          job.final_image = finalImage;
          job.status = "completed";
          job.stage = "completed";
          job.error = null;

          await saveJob(this.ctx, job);

          return controllerJson({
            ok: true,
            message: "STAGYLIGHT Q Master completed.",
            job
          });
        }

        return controllerJson({
          ok: true,
          message: "Job is waiting.",
          job
        });
      }

      return controllerJson({
        ok: false,
        error: "Unknown controller action."
      }, 400);

    } catch (e) {

      return controllerJson({
        ok: false,
        error: e.message
      }, 500);
    }
  }
}


// ===============================================================
// SOCIAL TABLES
// ===============================================================

async function ensureSocialTables(env) {

  requireDatabase(env);

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS social_follows (
        id TEXT PRIMARY KEY,
        follower_user_id TEXT NOT NULL,
        following_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (
          follower_user_id,
          following_user_id
        )
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_follows_follower
      ON social_follows (
        follower_user_id
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_follows_following
      ON social_follows (
        following_user_id
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS social_notifications (
        id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL,
        actor_user_id TEXT,
        type TEXT NOT NULL,
        post_id TEXT,
        message TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_notifications_target
      ON social_notifications (
        target_user_id,
        created_at
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_notifications_unread
      ON social_notifications (
        target_user_id,
        is_read
      )
    `)
    .run();
}


// ===============================================================
// MESSAGE TABLES
// ===============================================================

async function ensureMessageTables(env) {

  requireDatabase(env);

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS social_messages (
        id TEXT PRIMARY KEY,
        sender_user_id TEXT NOT NULL,
        recipient_user_id TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        text_content TEXT,
        payload_json TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_messages_sender_recipient
      ON social_messages (
        sender_user_id,
        recipient_user_id,
        created_at
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_messages_recipient_sender
      ON social_messages (
        recipient_user_id,
        sender_user_id,
        created_at
      )
    `)
    .run();

  await env.STAGYLIGHT_DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_social_messages_unread
      ON social_messages (
        recipient_user_id,
        is_read,
        created_at
      )
    `)
    .run();
}


function parsePayload(value) {

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}


function normalizeMessageRow(row) {

  return {
    id: row.id,

    sender_user_id:
      row.sender_user_id,

    sender_username:
      row.sender_username || "",

    sender_display_name:
      row.sender_display_name ||
      row.sender_username ||
      "STAGYLIGHT User",

    sender_profile_image_url:
      row.sender_profile_image_url ||
      null,

    recipient_user_id:
      row.recipient_user_id,

    recipient_username:
      row.recipient_username || "",

    recipient_display_name:
      row.recipient_display_name ||
      row.recipient_username ||
      "STAGYLIGHT User",

    recipient_profile_image_url:
      row.recipient_profile_image_url ||
      null,

    message_type:
      row.message_type || "text",

    type:
      row.message_type || "text",

    text:
      row.text_content || "",

    text_content:
      row.text_content || "",

    payload:
      parsePayload(row.payload_json),

    payload_json:
      row.payload_json || null,

    is_read:
      Number(row.is_read || 0) === 1,

    created_at:
      row.created_at
  };
}


function messagePreview(row) {

  if (row.text_content) {
    return String(row.text_content)
      .trim()
      .slice(0, 100);
  }

  const type =
    String(row.message_type || "")
      .toLowerCase();

  if (
    type === "qsticker" ||
    type === "q_sticker" ||
    type === "sticker" ||
    type === "demosticker"
  ) {
    return "✨ My Q Sticker";
  }

  if (
    type === "photo" ||
    type === "image"
  ) {
    return "📷 Photo";
  }

  if (type === "video") {
    return "🎬 Video";
  }

  if (type === "attachment") {
    return "📎 Attachment";
  }

  return "New message";
}


// ===============================================================
// SOCIAL HELPERS
// ===============================================================

async function findTargetUser(env, body) {

  const id = cleanText(
    body.target_user_id ||
    body.user_id ||
    body.recipient_user_id ||
    body.recipientUserId ||
    "",
    200
  );

  if (id) {

    const byId = await env.STAGYLIGHT_DB
      .prepare(`
        SELECT *
        FROM users
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();

    if (byId) {
      return byId;
    }
  }

  const username = normalizeUsername(
    body.target_username ||
    body.username ||
    body.recipient_username ||
    body.recipientUsername ||
    ""
  );

  if (!username) {
    return null;
  }

  return await env.STAGYLIGHT_DB
    .prepare(`
      SELECT *
      FROM users
      WHERE lower(username) = ?
      LIMIT 1
    `)
    .bind(username)
    .first();
}


async function getFollowCounts(env, userId) {

  const followers = await env.STAGYLIGHT_DB
    .prepare(`
      SELECT COUNT(*) AS total
      FROM social_follows
      WHERE following_user_id = ?
    `)
    .bind(userId)
    .first();

  const following = await env.STAGYLIGHT_DB
    .prepare(`
      SELECT COUNT(*) AS total
      FROM social_follows
      WHERE follower_user_id = ?
    `)
    .bind(userId)
    .first();

  return {
    followers:
      Number(followers?.total || 0),
    following:
      Number(following?.total || 0)
  };
}


async function createSocialNotification(env, data) {

  if (
    !data.targetUserId ||
    !data.actorUserId ||
    data.targetUserId === data.actorUserId
  ) {
    return null;
  }

  const id = crypto.randomUUID();

  const createdAt =
    data.createdAt ||
    new Date().toISOString();

  await env.STAGYLIGHT_DB
    .prepare(`
      INSERT INTO social_notifications (
        id,
        target_user_id,
        actor_user_id,
        type,
        post_id,
        message,
        is_read,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `)
    .bind(
      id,
      data.targetUserId,
      data.actorUserId,
      cleanText(data.type, 40),
      cleanNullableText(data.postId, 300),
      cleanNullableText(data.message, 500),
      createdAt
    )
    .run();

  return {
    id,
    target_user_id: data.targetUserId,
    actor_user_id: data.actorUserId,
    type: data.type,
    post_id: data.postId || null,
    message: data.message || "",
    is_read: false,
    created_at: createdAt
  };
}


function defaultNotificationMessage(type, actor) {

  const name =
    actor.display_name ||
    actor.username ||
    "Someone";

  if (type === "like") {
    return `${name} liked your post.`;
  }

  if (type === "comment") {
    return `${name} commented on your post.`;
  }

  if (type === "share") {
    return `${name} shared your post.`;
  }

  if (type === "message") {
    return `${name} sent you a message.`;
  }

  return `${name} interacted with you.`;
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
    .replace(/^@+/, "")
    .toLowerCase();
}


function isValidEmail(email) {
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}


function isValidUsername(username) {
  return (
    username.length >= 3 &&
    username.length <= 30 &&
    /^[a-z0-9._]+$/.test(username)
  );
}


function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}


function cleanNullableText(value, maxLength) {

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
    display_name: user.display_name,
    auth_provider: user.auth_provider,
    profile_image_url:
      user.profile_image_url || null,
    bio: user.bio || null,
    location: user.location || null,
    languages: user.languages || null,
    availability: user.availability || null,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}


// ===============================================================
// PASSWORD HASHING
// ===============================================================

const PASSWORD_ITERATIONS = 100000;


async function hashPassword(password) {

  const salt = crypto.getRandomValues(
    new Uint8Array(16)
  );

  const hash = await derivePassword(
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


async function verifyPassword(password, stored) {

  try {

    const parts =
      String(stored || "").split("$");

    if (
      parts.length !== 4 ||
      parts[0] !== "pbkdf2_sha256"
    ) {
      return false;
    }

    const iterations = Number(parts[1]);

    if (
      !Number.isInteger(iterations) ||
      iterations < 100000 ||
      iterations > 1000000
    ) {
      return false;
    }

    const salt =
      base64ToBytes(parts[2]);

    const expected =
      base64ToBytes(parts[3]);

    const actual = await derivePassword(
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

  const encoder = new TextEncoder();

  const keyMaterial =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
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


function constantTimeEqual(a, b) {

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

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}


// ===============================================================
// SESSION MANAGEMENT
// ===============================================================

async function createSession(env, userId) {

  const sessionId = crypto.randomUUID();
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const createdAt = new Date();

  const expiresAt =
    new Date(
      createdAt.getTime() +
      30 * 24 * 60 * 60 * 1000
    );

  await env.STAGYLIGHT_DB
    .prepare(`
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
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
    expires_at: expiresAt.toISOString()
  };
}


async function authenticateSession(env, rawToken) {

  const token = String(rawToken || "");

  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);

  const row = await env.STAGYLIGHT_DB
    .prepare(`
      SELECT
        s.id AS session_id,
        s.user_id AS session_user_id,
        s.expires_at AS session_expires_at,
        u.*
      FROM sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `)
    .bind(tokenHash)
    .first();

  if (!row) {
    return null;
  }

  const expires =
    Date.parse(row.session_expires_at);

  if (
    !Number.isFinite(expires) ||
    expires <= Date.now()
  ) {

    await env.STAGYLIGHT_DB
      .prepare(`
        DELETE FROM sessions
        WHERE id = ?
      `)
      .bind(row.session_id)
      .run();

    return null;
  }

  const user = {
    id: row.id,
    email: row.email,
    username: row.username,
    display_name: row.display_name,
    password_hash: row.password_hash,
    auth_provider: row.auth_provider,
    provider_user_id: row.provider_user_id,
    profile_image_url: row.profile_image_url,
    bio: row.bio,
    location: row.location,
    languages: row.languages,
    availability: row.availability,
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  return {
    user,
    expires_at: row.session_expires_at
  };
}


function randomToken(byteLength) {

  const bytes = crypto.getRandomValues(
    new Uint8Array(byteLength)
  );

  return bytesToBase64Url(bytes);
}


async function sha256Hex(value) {

  const bytes =
    new TextEncoder().encode(value);

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
        b.toString(16).padStart(2, "0")
    )
    .join("");
}


function bytesToBase64(bytes) {

  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}


function base64ToBytes(value) {

  const binary = atob(value);

  const bytes =
    new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}


function bytesToBase64Url(bytes) {

  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


// ===============================================================
// FAL
// ===============================================================

async function submitFal(
  falKey,
  imageUrl,
  prompt,
  quality = "high"
) {

  const r = await fetch(
    "https://queue.fal.run/fal-ai/gpt-image-1.5/edit",
    {
      method: "POST",

      headers: {
        "Authorization": `Key ${falKey}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        prompt,
        image_urls: [imageUrl],
        input_fidelity: "high",
        image_size: "1024x1024",
        quality,
        background: "opaque",
        num_images: 1,
        output_format: "png",
        sync_mode: false
      })
    }
  );

  const text = await r.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch (_) {}

  return {
    ok: r.ok,
    status: r.status,
    text,
    data
  };
}


async function checkFal(
  statusUrl,
  responseUrl,
  falKey
) {

  if (!statusUrl) {
    return {
      state: "error",
      error: "Missing fal.ai status URL."
    };
  }

  const r = await fetch(
    statusUrl,
    {
      headers: {
        "Authorization": `Key ${falKey}`
      }
    }
  );

  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (_) {
    return {
      state: "error",
      error: "Invalid fal.ai status response."
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
    String(data.status || "").toUpperCase();

  if (
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS"
  ) {
    return {
      state: "processing"
    };
  }

  if (status !== "COMPLETED") {
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

  const result = await fetch(
    responseUrl,
    {
      headers: {
        "Authorization": `Key ${falKey}`
      }
    }
  );

  const resultText = await result.text();

  let resultData;

  try {
    resultData = JSON.parse(resultText);
  } catch (_) {
    return {
      state: "error",
      error: "Invalid fal.ai result response."
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
// STAGE 1 PROMPT
// ===============================================================

function getIdentityPrompt() {

  return `
Create ONE premium illustrated portrait of the EXACT SAME ADULT
PERSON shown in the supplied reference photograph.

This is STAGYLIGHT IDENTITY MASTER — STAGE 1.

IDENTITY IS THE HIGHEST PRIORITY.

Preserve the person's actual face, hairstyle, skin tone,
adult age appearance, clothing and accessories.

Do NOT substitute generic anime facial features.
Do NOT beautify the person into somebody else.
NO baby face.
NO child appearance.
NO huge anime eyes.

Show the complete hairstyle, head, face, chin, neck,
shoulders and upper chest.

Leave clean background above the hairstyle.

If illustration style conflicts with recognizable identity,
PRESERVE IDENTITY.

Generate exactly ONE square portrait.
`;
}


// ===============================================================
// STAGE 2 PROMPT
// ===============================================================

function getQMasterPrompt() {

  return `
Transform the supplied STAGYLIGHT IDENTITY MASTER into ONE
premium ADULT Q CHARACTER of the EXACT SAME PERSON.

ABSOLUTE PRIORITY:
PRESERVE THE FACE.

Do NOT redesign or reinterpret the person's identity.

Preserve face proportions, eyes, nose, mouth, jaw, chin,
skin tone, adult age appearance and distinctive features.

NO baby face.
NO child appearance.
NO huge anime eyes.
NO inflated cheeks.
NO tiny nose.
NO tiny chin.

Create the Q feeling mainly through a slightly larger head,
compact upper body and premium illustrated rendering.

Preserve the SAME hairstyle, clothing and accessories.

No unwanted makeup or blush.

Show the entire hairstyle, full head, face, chin, neck,
shoulders and upper body.

No text.
No watermark.
No extra person.
No collage.

IF CUTENESS CONFLICTS WITH IDENTITY:
IDENTITY MUST WIN.

Generate exactly ONE square Adult Q Master.
`;
}


// ===============================================================
// Q-STICKER PROMPT
// ===============================================================

function getStickerPrompt(type) {

  const reactions = {

    haha: `
HAPPY / LAUGHING REACTION 😂
Create a joyful laughing expression with a natural smile,
cheerful eyes and energetic happy reaction.
`,

    love: `
LOVE / AFFECTION REACTION ❤️
Create a warm affectionate expression with a gentle smile
and a clear small heart hand gesture near the chest.
`,

    sad: `
SAD / UPSET REACTION 😭
Create a clearly sad emotional expression.
Small natural tears are allowed.
`,

    angry: `
ANGRY / FRUSTRATED REACTION 😡
Create a clearly angry and frustrated expression with
naturally furrowed eyebrows and a serious tense mouth.
`,

    like: `
LIKE / APPROVAL REACTION 👍
Create a positive confident approval reaction with ONE
clear thumbs-up gesture.
`,

    celebrate: `
CELEBRATE / EXCITED REACTION 🎉
Create an energetic celebration reaction with an enthusiastic
smile and a small amount of tasteful confetti.
`
  };

  const reaction =
    reactions[type] ||
    reactions.haha;

  return `
Create exactly ONE premium STAGYLIGHT Q reaction sticker using
the supplied MASTER Q image.

KEEP THE EXACT SAME CHARACTER.

Preserve the same recognizable adult face, facial structure,
eyes, nose, mouth, jawline, chin, skin tone, hairstyle,
clothing and accessories.

Do NOT invent a new character.
Do NOT redesign the face.
Do NOT make the person younger.
Do NOT create huge anime eyes.
Do NOT create a baby face.

REACTION:

${reaction}

Match the supplied Master Q's existing illustration style.

Keep all important hands and gestures completely inside frame.

No written text.
No watermark.
No logo.
No extra people.
No collage.

IF EMOTION CONFLICTS WITH IDENTITY:
IDENTITY MUST WIN.

Generate exactly ONE square reaction Q-Sticker.
`;
}


// ===============================================================
// AI HELPERS
// ===============================================================

function controller(env, name) {

  if (!env.AI_JOB_CONTROLLER) {
    throw new Error(
      "AI_JOB_CONTROLLER binding is unavailable."
    );
  }

  const id =
    env.AI_JOB_CONTROLLER.idFromName(name);

  return env.AI_JOB_CONTROLLER.get(id);
}


function internalRequest(action, data) {

  return new Request(
    "https://stagylight.internal/" + action,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        ...data,
        action
      })
    }
  );
}


async function saveJob(ctx, job) {

  job.updated_at =
    new Date().toISOString();

  await ctx.storage.put("job", job);
}


function extractImage(data) {

  if (
    data &&
    Array.isArray(data.images) &&
    data.images.length > 0 &&
    data.images[0]?.url
  ) {
    return data.images[0].url;
  }

  return null;
}


function json(data, status, cors) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    }
  );
}


function controllerJson(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}


async function forward(response, cors) {

  return new Response(
    await response.text(),
    {
      status: response.status,

      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    }
  );
}

