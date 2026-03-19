const axios = require("axios");
const fs = require("fs");
const { loadCommandFromFile } = require("../../utils/system/loader");

const COMMANDS_DIR = __dirname;

async function ghUpload(fileName, fileContent) {
  const { githubToken, repo, branch } = global.config || {};
  if (!githubToken || !repo || !branch) return null;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${fileName}`;
  const headers = {
    Authorization: `token ${githubToken}`,
    "Content-Type": "application/json"
  };

  let sha;
  try {
    const res = await axios.get(apiUrl, { headers });
    sha = res.data.sha;
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  await axios.put(apiUrl, {
    message: `[note] Upload ${fileName}`,
    content: Buffer.from(fileContent).toString("base64"),
    branch,
    ...(sha ? { sha } : {})
  }, { headers });

  return {
    rawUrl: `https://raw.githubusercontent.com/${repo}/${branch}/${fileName}`,
    editUrl: `https://github.com/${repo}/edit/${branch}/${fileName}`
  };
}

module.exports = {
  config: {
    name: "note",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "Ljzi",
    description: "Export & import code lệnh qua GitHub",
    commandCategory: "Admin",
    usages: ".note <file.js> [url]",
    cooldowns: 3
  },

  run: async function({ args, send, senderId, registerReaction }) {
    if (!args[0]) {
      return send(
        "❌ Thiếu tên file!\n" +
        "📌 Cách dùng: .note <tên_lệnh.js>\n" +
        "Ví dụ: .note ping.js"
      );
    }

    const { githubToken, repo, branch } = global.config || {};
    if (!githubToken || !repo || !branch) {
      return send("⚠️ Chưa cấu hình GitHub trong config.json\n(githubToken, repo, branch)");
    }

    const fileName = args[0].endsWith(".js") ? args[0] : `${args[0]}.js`;
    const filePath = `${COMMANDS_DIR}/${fileName}`;
    const url = args[1] || null;

    // ── Chế độ Import: có URL → xác nhận tải về ─────────────────────────────
    if (url && /^https?:\/\//.test(url)) {
      const msg = await send(
        `[ 📝 CODE IMPORT ]\n─────────────────\n` +
        `📁 File: src/commands/${fileName}\n\n` +
        `🔗 Nguồn:\n${url}\n` +
        `─────────────────\n` +
        `📌 Thả cảm xúc để tải & ghi đè file`
      );

      const messageId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
      if (!messageId) return send("⚠️ Không thể đăng ký xác nhận.");

      registerReaction({
        messageId,
        commandName: "note",
        ttl: 5 * 60 * 1000,
        payload: { action: "import", fileName, filePath, url, senderId }
      });
      return;
    }

    // ── Chế độ Export: upload file lên GitHub ───────────────────────────────
    if (!fs.existsSync(filePath)) {
      return send(`❌ Không tìm thấy file: ${fileName}`);
    }

    const fileContent = fs.readFileSync(filePath, "utf8");

    let links;
    try {
      links = await ghUpload(fileName, fileContent);
    } catch (err) {
      return send(`❌ Upload GitHub thất bại:\n${err?.response?.data?.message || err.message}`);
    }

    const msg = await send(
      `[ 📝 CODE EXPORT ]\n─────────────────\n` +
      `📁 File: src/commands/${fileName}\n\n` +
      `🔗 Raw:\n${links.rawUrl}\n\n` +
      `✏️ Edit:\n${links.editUrl}\n` +
      `─────────────────\n` +
      `📌 Thả cảm xúc để tải code từ GitHub về bot`
    );

    const messageId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
    if (!messageId) return;

    registerReaction({
      messageId,
      commandName: "note",
      ttl: 30 * 60 * 1000,
      payload: { action: "export", fileName, filePath, rawUrl: links.rawUrl, senderId }
    });

    logInfo(`[note] Đã upload ${fileName} → GitHub: ${links.editUrl}`);
  },

  onReaction: async function({ data, send, commands, uid, registerReaction }) {
    const { action, fileName, filePath, rawUrl, url, senderId } = data;

    if (String(uid) !== String(senderId)) return;

    // ── Import: tải từ URL về ghi vào file ──────────────────────────────────
    if (action === "import") {
      try {
        const fetchUrl = url.includes("?raw=true") ? url : `${url}?raw=true`;
        const res = await axios.get(fetchUrl, { responseType: "text" });
        const newCode = res.data;

        fs.writeFileSync(filePath, newCode, "utf8");

        const loaded = loadCommandFromFile(filePath);
        if (loaded && commands) commands.set(loaded.name, loaded.command);

        let links = null;
        try { links = await ghUpload(fileName, newCode); } catch (_) {}

        return send(
          `[ 📝 CODE IMPORT ]\n─────────────────\n` +
          `📁 File: src/commands/${fileName}\n\n` +
          (links ? `🔗 Raw:\n${links.rawUrl}\n\n✏️ Edit:\n${links.editUrl}\n` : "") +
          `─────────────────\n` +
          `✅ Đã tải, ghi đè & reload!`
        );
      } catch (err) {
        return send(`❌ Lỗi import:\n${err?.response?.data || err.message}`);
      }
    }

    // ── Export confirm: pull từ GitHub raw → ghi local → reload ────────────
    if (action === "export") {
      try {
        // Lấy nội dung mới nhất từ GitHub (thêm nocache header để tránh CDN cache)
        const res = await axios.get(rawUrl, {
          responseType: "text",
          headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
        });
        const newCode = res.data;

        // Ghi đè file local
        fs.writeFileSync(filePath, newCode, "utf8");

        // Reload lệnh trong bộ nhớ
        const loaded = loadCommandFromFile(filePath);
        if (loaded && commands) commands.set(loaded.name, loaded.command);

        logInfo(`[note] Đã pull & reload ${fileName} từ GitHub`);

        // Upload lại để sync (cập nhật sha)
        let links = null;
        try { links = await ghUpload(fileName, newCode); } catch (_) {}

        const msg = await send(
          `[ 📝 CODE EXPORT ]\n─────────────────\n` +
          `📁 File: src/commands/${fileName}\n\n` +
          `🔗 Raw:\n${(links || {}).rawUrl || rawUrl}\n\n` +
          `✏️ Edit:\n${(links || {}).editUrl || ""}\n` +
          `─────────────────\n` +
          `✅ Đã lưu & reload!\n` +
          `📌 Thả cảm xúc để pull lại`
        );

        const messageId = msg?.message?.msgId || msg?.msgId || msg?.data?.msgId;
        if (messageId) {
          registerReaction({
            messageId,
            commandName: "note",
            ttl: 30 * 60 * 1000,
            payload: { action: "export", fileName, filePath, rawUrl: (links || {}).rawUrl || rawUrl, senderId }
          });
        }
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404) {
          return send(`❌ File chưa có trên GitHub. Hãy chạy lại .note ${fileName} để upload trước.`);
        }
        return send(`❌ Lỗi pull từ GitHub:\n${err?.response?.data?.message || err.message}`);
      }
    }
  }
};
