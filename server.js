// server.js
import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const execFileAsync = promisify(execFile);

// 👇 Replace this with the exact path from: `which yt-dlp`
const YTDLP_PATH = "/opt/homebrew/bin/yt-dlp"; // e.g. "/usr/local/bin/yt-dlp"

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[WARN] OPENAI_API_KEY is not set. The transcription step will fail until you add it."
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function sendError(res, label, err) {
  console.error(`\n[ERROR] ${label}`);
  if (err) {
    console.error("Message:", err.message || err);
    if (err.stderr) {
      console.error("Stderr:", err.stderr.toString());
    }
    if (err.stdout) {
      console.error("Stdout:", err.stdout.toString());
    }
    if (err.response && err.response.data) {
      console.error("OpenAI response data:", err.response.data);
    }
  }
  return res.status(500).json({
    error: label
  });
}

app.post("/api/fetch-transcript", async (req, res) => {
  const { videoUrl } = req.body || {};
  console.log("\n[INFO] /api/fetch-transcript called with:", videoUrl);

  if (!videoUrl || typeof videoUrl !== "string") {
    return res.status(400).json({ error: "videoUrl is required" });
  }

  if (!videoUrl.includes("youtube.com") && !videoUrl.includes("youtu.be")) {
    return res.status(400).json({ error: "Please send a valid YouTube URL." });
  }

  const outputDir = "./tmp";
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
      console.log("[INFO] Created tmp directory");
    }
  } catch (err) {
    return sendError(res, "Could not create tmp directory on the server.", err);
  }

  // ❗ IMPORTANT: let yt-dlp decide the extension (webm, m4a, etc.)
  const outTemplate = path.join(outputDir, "audio-%(id)s.%(ext)s");
  let latestFile;

  // 1) Download audio with yt-dlp (no ffmpeg / no re-encode)
  try {
    console.log("[INFO] Running yt-dlp to download bestaudio (no postprocessing)...");
    const { stdout, stderr } = await execFileAsync(
      YTDLP_PATH,
      [
        "-f",
        "bestaudio",          // pick best audio format
        "-o",
        outTemplate,          // audio-<id>.<ext>
        videoUrl
      ],
      {
        maxBuffer: 1024 * 1024 * 10
      }
    );

    console.log("[INFO] yt-dlp stdout:", stdout);
    if (stderr) {
      console.log("[INFO] yt-dlp stderr:", stderr);
    }

    const files = fs
      .readdirSync(outputDir)
      .filter(
        (f) =>
          f.startsWith("audio-") &&
          !f.endsWith(".part") // ignore partial files
      );

    if (!files.length) {
      return sendError(res, "Audio download failed: no audio files found.", null);
    }

    // Take the last one (most recent)
    latestFile = path.join(outputDir, files[files.length - 1]);
    console.log("[INFO] Using audio file:", latestFile);
  } catch (err) {
    return sendError(
      res,
      "Audio download failed. Check yt-dlp is installed and the video is accessible.",
      err
    );
  }

  // 2) Send audio to OpenAI
  let transcription;
  try {
    if (!process.env.OPENAI_API_KEY) {
      return sendError(
        res,
        "OPENAI_API_KEY is not set on the server. Add it and redeploy.",
        null
      );
    }

    console.log("[INFO] Sending audio to OpenAI for transcription...");
    transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(latestFile),
      model: "gpt-4o-mini-transcribe", // or another transcription-capable model
      response_format: "json",
      temperature: 0.2
    });

    console.log("[INFO] Transcription received from OpenAI.");
  } catch (err) {
    return sendError(
      res,
      "OpenAI transcription failed. Check your API key and model.",
      err
    );
  } finally {
    if (latestFile) {
      try {
        fs.unlinkSync(latestFile);
        console.log("[INFO] Deleted temp file:", latestFile);
      } catch (e) {
        console.warn("[WARN] Could not delete temp file:", e.message || e);
      }
    }
  }

  try {
    return res.json({
      transcript: transcription.text
    });
  } catch (err) {
    return sendError(res, "Failed to send transcript response.", err);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
