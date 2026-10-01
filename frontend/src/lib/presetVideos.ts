export interface PresetVideo {
  title: string;
  url: string;
  tag: string;
}

/** Real YouTube channels used as curated starting points — also doubles as
 * honest "built for lectures like these" content on the landing page, since
 * no customer logos or testimonials exist for this project. */
export const PRESET_VIDEOS: PresetVideo[] = [
  {
    title: "But what is a neural network? (3Blue1Brown)",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
    tag: "Machine Learning"
  },
  {
    title: "How Computers Compute (CrashCourse)",
    url: "https://www.youtube.com/watch?v=1S0aBV-Waeo",
    tag: "Computer Science"
  },
  {
    title: "The Simple Solution to Traffic (CGP Grey)",
    url: "https://www.youtube.com/watch?v=iHzzSaoMx3E",
    tag: "Systems & Logic"
  }
];
