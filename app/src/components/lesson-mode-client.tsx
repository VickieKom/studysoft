"use client";

import dynamic from "next/dynamic";

// The panel and the stage start from the state the browser kept (#152), which the server cannot read: rendered in the browser only.
export const LessonPanelClient = dynamic(() => import("./lesson-panel").then((m) => m.LessonPanel), { ssr: false });
export const LessonStageClient = dynamic(() => import("./lesson-stage").then((m) => m.LessonStage), { ssr: false });
