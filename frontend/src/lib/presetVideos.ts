export interface PresetVideo {
  title: string;
  url: string;
  tag: string;
}

/** Real YouTube channels used as curated starting points — also doubles as
 * honest "built for lectures like these" content on the landing page, since
 * no customer logos or testimonials exist for this project. */
// Chosen short (5-12 min) so a live demo stays fast end-to-end; each ID
// verified directly (title, duration, real transcript fetch) this session —
// the previous set had one dead video and one mislabeled ID pointing to an
// unrelated Computerphile video.
export const PRESET_VIDEOS: PresetVideo[] = [
  {
    title: "Large Language Models explained briefly (3Blue1Brown)",
    url: "https://www.youtube.com/watch?v=LPZh9BOjkQs",
    tag: "Machine Learning"
  },
  {
    title: "Early Computing (CrashCourse Computer Science #1)",
    url: "https://www.youtube.com/watch?v=O5nskjZ_GoI",
    tag: "Computer Science"
  },
  {
    title: "Traffic Has a Perfect Solution (CGP Grey)",
    url: "https://www.youtube.com/watch?v=iHzzSao6ypE",
    tag: "Systems & Logic"
  }
];
