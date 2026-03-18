const fs = require("fs");
const path = require("path");
const axios = require("axios");

module.exports = {
  config: {
    name: "adc",
    version: "3.1.0",
    hasPermssion: 2,
    credits: "Ljzi",
    description: "Share / tải / tạo command mọi lệnh qua GitHub Gist, reload ngay",
    commandCategory: "Admin",
    usages: ".adc <tenlenh> [link] hoặc reply code",
    cooldowns: 0
  },

  run: async ({ api, event, args, send, commands }) => {
    const name = args[0];
    const link = args[1];

    if (!name) return send("❎ Nhập tên lệnh.");

    const filePath = path.join(process.cwd(), "src", "commands", `${name}.js`);

    // 1. Tạo command từ reply
    if (event.data?.quote) {
      const code = event.data.quote.content || event.data.quote.text || "";
      if (!code.includes("module.exports")) return send("❎ Code không hợp lệ.");

      fs.writeFileSync(filePath, code);
      delete require.cache[require.resolve(filePath)];
      const loaded = require(filePath);
      if (loaded?.config?.name) commands.set(loaded.config.name, loaded);
      return send(`✅ Đã tạo command từ reply: ${loaded?.config?.name || name}`);
    }

    // 2. Tải command từ link
    if (link) {
      try {
        let raw = link;
        if (link.includes("github.com") && link.includes("/blob/"))
          raw = link.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
        if (link.includes("gist.github.com"))
          raw = link.replace("gist.github.com", "gist.githubusercontent.com") + "/raw";
        if (link.includes("pastebin.com")) raw = link.replace("/p/", "/raw/");
        if (link.includes("dpaste.com")) raw = link + ".txt";
        if (link.includes("hastebin.com")) raw = link + ".js";

        const res = await axios.get(raw);
        const code = res.data;

        if (!code.includes("module.exports")) return send("❎ Code không đúng format command.");

        fs.writeFileSync(filePath, code);
        delete require.cache[require.resolve(filePath)];
        const loaded = require(filePath);
        if (loaded?.config?.name) commands.set(loaded.config.name, loaded);
        return send(`✅ Đã cài command: ${loaded?.config?.name || name}`);
      } catch (err) {
        return send(`❎ Không tải được code\n${err.message}`);
      }
    }

    // 3. Share command qua GitHub Gist
    if (!fs.existsSync(filePath)) return send("❎ Lệnh không tồn tại. Hãy reply code hoặc nhập link để cài.");

    try {
      const code = fs.readFileSync(filePath, "utf8");
      const token = global.config.githubToken;
      if (!token) return send("❌ Chưa cấu hình githubToken trong config.json");

      const res = await axios.post(
        "https://api.github.com/gists",
        {
          description: `Command ${name}`,
          public: true,
          files: {
            [`${name}.js`]: { content: code }
          }
        },
        {
          headers: {
            Authorization: `token ${token}`,
            "User-Agent": "mizai-bot",
            Accept: "application/vnd.github+json"
          }
        }
      );

      const raw = res.data.files[`${name}.js`].raw_url;

      return send(
        `📤 Share command thành công\n\n📄 ${name}.js\n🔗 Raw URL: ${raw}`
      );
    } catch (err) {
      return send(`⚠️ Lỗi tạo Gist:\n${err.response?.data?.message || err.message}`);
    }
  }
};