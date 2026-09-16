import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'

/**
 * Video derivatives — WebM plus a poster frame (FR-058).
 *
 * `ffmpeg` is spawned directly through `node:child_process`, not driven through
 * `fluent-ffmpeg`, for two reasons stated in media-pipeline.md §6: that
 * wrapper's latest release is effectively unmaintained, and a direct spawn
 * gives the explicit kill control the budget rule requires. A wrapper that
 * cannot be made to hard-kill on timeout turns a 300 s budget into a
 * suggestion.
 *
 * A subprocess also keeps a CPU-bound transcode off the event loop, so
 * `@fastify/under-pressure` does not start shedding unrelated traffic just
 * because someone uploaded a video.
 */

export const VIDEO_WIDTH = 1280
export const POSTER_WIDTH = 1600

/**
 * Run ffmpeg with a hard kill at the budget.
 *
 * SIGKILL rather than SIGTERM after the grace period: ffmpeg handles SIGTERM by
 * finishing the current frame and flushing, which on a stuck input is exactly
 * the thing that is not happening. The budget is a budget.
 */
function runFfmpeg(args, { timeoutMs, binary = ffmpegPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stderr.on('data', (chunk) => {
      // Bounded: ffmpeg is chatty, and an unbounded buffer on a long transcode
      // is its own memory problem.
      if (stderr.length < 8192) stderr += chunk.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        const err = new Error(`ffmpeg exceeded its ${timeoutMs} ms budget and was killed`)
        err.code = 'FFMPEG_TIMEOUT'
        return reject(err)
      }
      if (code !== 0) {
        // The message is the last few lines, which is what a human wants; the
        // full output rides along on the error because the probe below reads
        // its answer from it. ffmpeg reports stream metadata and *then* exits
        // non-zero when given no output file, so discarding stderr on failure
        // would throw away the very thing being asked for.
        const err = new Error(`ffmpeg exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`)
        err.code = 'FFMPEG_FAILED'
        err.stderr = stderr
        return reject(err)
      }
      resolve({ stderr })
    })
  })
}

/**
 * Probe a video's intrinsic dimensions and duration.
 *
 * Runs synchronously at upload (FR-055) with a short budget of its own: reading
 * a header is not transcoding, and giving it the transcode budget would let a
 * malformed file hold an upload request open for five minutes.
 */
export async function probeVideo(buffer, { timeoutMs = 10_000, binary = ffmpegPath } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gwc-probe-'))
  const input = path.join(dir, 'input')
  try {
    await writeFile(input, buffer)
    // ffmpeg with no output prints the stream metadata to stderr and exits
    // non-zero; that is the documented way to probe without shipping ffprobe.
    const { stderr } = await runFfmpeg(['-i', input], { timeoutMs, binary }).catch((err) => ({
      stderr: err.stderr ?? err.message ?? '',
    }))

    const size = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(stderr)
    const duration = /Duration:\s(\d+):(\d+):(\d+\.?\d*)/.exec(stderr)

    return {
      width: size ? Number(size[1]) : null,
      height: size ? Number(size[2]) : null,
      durationMs: duration
        ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000)
        : null,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Transcode to WebM (VP9 / Opus) and extract a WebP poster frame.
 *
 * @param options.timeoutMs the 300 s job budget from breakers.js
 * @returns {Promise<{video: {buffer, width, height, bytes}, poster: {buffer, width, height, bytes}}>}
 */
export async function deriveVideo(buffer, { timeoutMs = 300_000, binary = ffmpegPath, width = VIDEO_WIDTH } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gwc-video-'))
  const input = path.join(dir, 'input')
  const videoOut = path.join(dir, 'out.webm')
  const posterOut = path.join(dir, 'poster.webp')

  try {
    await writeFile(input, buffer)

    await runFfmpeg(
      [
        '-y', '-i', input,
        // Never upscale: `min(iw,W)` leaves a small source at its own width,
        // the same rule the image breakpoints follow (FR-056).
        '-vf', `scale='min(iw,${width})':-2`,
        '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33',
        // Speeds up VP9 materially at a quality cost invisible at these sizes.
        '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
        '-c:a', 'libopus', '-b:a', '96k',
        // Metadata is stripped here too: a video carries the same location tags
        // a photograph does (FR-054).
        '-map_metadata', '-1',
        videoOut,
      ],
      { timeoutMs, binary },
    )

    await runFfmpeg(
      [
        '-y', '-i', input,
        // One second in, not frame zero: the first frame of a phone recording
        // is very often black or a blur, which makes a poor poster.
        '-ss', '1', '-frames:v', '1',
        '-vf', `scale='min(iw,${POSTER_WIDTH})':-2`,
        '-map_metadata', '-1',
        posterOut,
      ],
      { timeoutMs: Math.min(timeoutMs, 30_000), binary },
    )

    const [videoBuffer, posterBuffer] = await Promise.all([readFile(videoOut), readFile(posterOut)])
    const probed = await probeVideo(videoBuffer, { binary })

    const sharp = (await import('sharp')).default
    const posterMeta = await sharp(posterBuffer).metadata()

    return {
      video: {
        buffer: videoBuffer,
        width: probed.width ?? width,
        height: probed.height ?? width,
        bytes: videoBuffer.length,
      },
      poster: {
        buffer: posterBuffer,
        width: posterMeta.width,
        height: posterMeta.height,
        bytes: posterBuffer.length,
      },
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Whether a usable ffmpeg binary is present, so a suite can skip loudly. */
export const hasFfmpeg = Boolean(ffmpegPath)
