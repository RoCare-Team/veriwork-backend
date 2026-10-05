import {
  CompareFacesCommand,
  DetectFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { readLocalUpload } from '../utils/fileUpload.js';
import { getFileFromS3, s3KeyFromUrl } from './s3Service.js';

let rekognitionClient;

function getClient() {
  if (!rekognitionClient) {
    rekognitionClient = new RekognitionClient({
      region: env.faceMatch.region,
      credentials: {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      },
    });
  }
  return rekognitionClient;
}

export function isFaceMatchEnabled() {
  return env.faceMatch.enabled;
}

// Thrown when the stored Aadhaar image itself is the problem (missing, wrong
// format) — the user's selfie was fine, so the attempt shouldn't count.
export const REFERENCE_IMAGE_ERROR = 'REFERENCE_IMAGE_ERROR';

function referenceImageError(message) {
  const err = ApiError.badRequest(message);
  err.code = REFERENCE_IMAGE_ERROR;
  return err;
}

// Rekognition only accepts JPEG and PNG.
function isJpegOrPng(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  return isJpeg || isPng;
}

/**
 * Build a Rekognition Image param from a stored image descriptor. S3 objects are
 * downloaded and sent as bytes rather than passed as an S3Object: the S3Object
 * path needs Rekognition itself to read the bucket (same region, bucket policy,
 * KMS key), which fails with InvalidS3ObjectException when any of those differ.
 */
async function toRekognitionImage(stored) {
  let buffer = stored?.buffer || null;

  if (!buffer && env.aws.enabled) {
    const key = stored?.key || s3KeyFromUrl(stored?.url);
    if (key) {
      try {
        buffer = await getFileFromS3(key);
      } catch (err) {
        console.error(`[faceMatch] could not download reference image ${key}: ${err.name} ${err.message}`);
        throw referenceImageError(
          'Your Aadhaar photo could not be loaded. Please re-upload your Aadhaar card.',
        );
      }
    }
  }

  if (!buffer) buffer = await readLocalUpload(stored?.url);
  if (!buffer) {
    throw referenceImageError('Your Aadhaar photo could not be found. Please re-upload your Aadhaar card.');
  }
  if (!isJpegOrPng(buffer)) {
    throw referenceImageError(
      'Your Aadhaar card was uploaded as a PDF or unsupported image. Please re-upload the front side as a JPG or PNG photo.',
    );
  }
  return { Bytes: buffer };
}

function describeAwsError(err) {
  const name = err?.name || '';
  if (name === 'InvalidParameterException') {
    // Rekognition raises this when it finds no face at all in an image.
    return 'No face could be detected in one of the images. Retake the selfie in good lighting.';
  }
  if (name === 'ImageTooLargeException') {
    return 'The image is too large for face verification. Try a smaller photo.';
  }
  if (name === 'InvalidImageFormatException') {
    return 'One of the images is not a valid photo. Retake the selfie and try again.';
  }
  if (name === 'AccessDeniedException' || name === 'UnrecognizedClientException') {
    return 'Face verification is temporarily unavailable. Please try again later.';
  }
  if (name === 'ThrottlingException' || name === 'ProvisionedThroughputExceededException') {
    return 'Face verification is busy right now. Please try again in a moment.';
  }
  return err?.message || 'Face verification failed';
}

/**
 * Detect faces in a selfie and assert it is usable: exactly one face, detected
 * with high confidence and reasonably front-facing.
 */
export async function detectSelfieFace(buffer) {
  const response = await getClient().send(
    new DetectFacesCommand({
      Image: { Bytes: buffer },
      Attributes: ['ALL'],
    }),
  );

  const faces = response.FaceDetails || [];

  if (faces.length === 0) {
    throw ApiError.badRequest('No face detected in the selfie. Face the camera and try again.');
  }
  if (faces.length > 1) {
    throw ApiError.badRequest('More than one face is visible. Make sure you are alone in frame.');
  }

  const face = faces[0];
  if ((face.Confidence ?? 0) < env.faceMatch.minDetectionConfidence) {
    throw ApiError.badRequest('The face in the selfie is unclear. Retake in better lighting.');
  }

  const yaw = Math.abs(face.Pose?.Yaw ?? 0);
  const pitch = Math.abs(face.Pose?.Pitch ?? 0);
  if (yaw > env.faceMatch.maxPoseDegrees || pitch > env.faceMatch.maxPoseDegrees) {
    throw ApiError.badRequest('Look straight at the camera and capture again.');
  }

  const sharpness = face.Quality?.Sharpness ?? 0;
  const brightness = face.Quality?.Brightness ?? 0;
  if (sharpness < env.faceMatch.minSharpness) {
    throw ApiError.badRequest('The selfie is too blurry. Hold still and capture again.');
  }
  if (brightness < env.faceMatch.minBrightness) {
    throw ApiError.badRequest('The selfie is too dark. Move to better lighting and try again.');
  }

  return {
    confidence: face.Confidence ?? 0,
    yaw: face.Pose?.Yaw ?? 0,
    pitch: face.Pose?.Pitch ?? 0,
    eyesOpen: face.EyesOpen?.Value ?? null,
    sharpness,
    brightness,
    boundingBox: face.BoundingBox || null,
  };
}

/** Yaw for a single frame, used to prove the head actually turned. */
async function detectPoseYaw(buffer) {
  try {
    const response = await getClient().send(
      new DetectFacesCommand({ Image: { Bytes: buffer }, Attributes: ['DEFAULT'] }),
    );
    const face = (response.FaceDetails || [])[0];
    return face?.Pose?.Yaw ?? null;
  } catch {
    return null;
  }
}

/**
 * Liveness signal that does not depend on a paid liveness session: the user is
 * prompted to turn left then right, and we confirm the yaw actually moved
 * across the captured frames. A printed photo held to the camera cannot do this.
 */
export async function checkPoseLiveness(poseBuffers = []) {
  const usable = poseBuffers.filter(Boolean);
  if (usable.length < 2) {
    return { passed: false, yawSpread: 0, reason: 'not_enough_frames' };
  }

  const yaws = (await Promise.all(usable.map(detectPoseYaw))).filter((y) => y !== null);
  if (yaws.length < 2) {
    return { passed: false, yawSpread: 0, reason: 'face_missing_in_frames' };
  }

  const yawSpread = Math.max(...yaws) - Math.min(...yaws);
  return {
    passed: yawSpread >= env.faceMatch.minYawSpread,
    yawSpread: Number(yawSpread.toFixed(2)),
    reason: yawSpread >= env.faceMatch.minYawSpread ? '' : 'insufficient_head_movement',
  };
}

/**
 * Compare a live selfie against the face printed on the Aadhaar card.
 * Returns the best similarity Rekognition found, whether or not it clears the
 * threshold — the caller decides what to do with a near miss.
 */
export async function compareWithReference(selfieBuffer, referenceImage) {
  const source = await toRekognitionImage(referenceImage);

  const response = await getClient().send(
    new CompareFacesCommand({
      SourceImage: source,
      TargetImage: { Bytes: selfieBuffer },
      // Ask for everything above a low bar so a near miss still reports a
      // number instead of coming back as an empty match list.
      SimilarityThreshold: 1,
      QualityFilter: 'AUTO',
    }),
  );

  const matches = response.FaceMatches || [];
  const best = matches.reduce(
    (acc, m) => ((m.Similarity ?? 0) > acc ? m.Similarity : acc),
    0,
  );

  return {
    similarity: Number(best.toFixed(2)),
    unmatchedFaces: (response.UnmatchedFaces || []).length,
  };
}

/**
 * Full biometric check: the selfie must contain one clear face, the head must
 * have actually moved across the liveness frames, and the face must match the
 * photo on the approved Aadhaar card.
 */
export async function runFaceVerification({ selfieBuffer, poseBuffers = [], referenceImage }) {
  if (!env.faceMatch.enabled) {
    // No Rekognition credentials. In production this is a hard failure — we do
    // not want a mock quietly marking people as biometrically verified.
    if (!env.isDev) {
      throw ApiError.badRequest(
        'Face verification is not configured on this server. Contact support.',
      );
    }
    return {
      provider: 'mock',
      similarity: 100,
      threshold: env.faceMatch.minSimilarity,
      matched: true,
      liveness: { passed: true, yawSpread: 0, reason: 'mock' },
      detection: null,
    };
  }

  try {
    const detection = await detectSelfieFace(selfieBuffer);
    const liveness = await checkPoseLiveness([...poseBuffers, selfieBuffer]);
    const { similarity } = await compareWithReference(selfieBuffer, referenceImage);

    return {
      provider: 'rekognition',
      similarity,
      threshold: env.faceMatch.minSimilarity,
      matched: similarity >= env.faceMatch.minSimilarity,
      liveness,
      detection,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error(`[faceMatch] Rekognition error: ${err?.name} ${err?.message}`);
    throw ApiError.badRequest(describeAwsError(err));
  }
}
