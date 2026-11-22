// The assessment's files on the card (#252): the recording for «Аудирование»
// and the picture for «Говорение». Plain data and functions only.
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "./homework-format";

export const ASSESSMENT_FILES = ["listening", "picture"] as const;
export type AssessmentFile = (typeof ASSESSMENT_FILES)[number];

/** As a homework task's recording and picture (#127, #33). */
export const MAX_ASSESSMENT_RECORDING_BYTES = MAX_AUDIO_BYTES;
export const MAX_ASSESSMENT_PICTURE_BYTES = MAX_IMAGE_BYTES;

export const ASSESSMENT_STATUS_LABELS = { draft: "Черновик", approved: "Утверждён" } as const;

/** Where the file is uploaded and served. */
export const assessmentFileUrl = (assessmentId: string, which: AssessmentFile) => `/api/files/assessments/${assessmentId}/${which}`;
