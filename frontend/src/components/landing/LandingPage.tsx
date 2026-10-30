import React, { useRef } from 'react';
import { VideoInput, type VideoInputHandle } from '../VideoInput';
import { CreatorStrip } from './CreatorStrip';
import { FeatureShowcase } from './FeatureShowcase';
import { TaglineReveal } from './TaglineReveal';
import { HowItWorks } from './HowItWorks';
import { OutcomeStats } from './OutcomeStats';
import { PhilosophyQuotes } from './PhilosophyQuotes';
import { LandingFaq } from './LandingFaq';
import { FinalCTABand } from './FinalCTABand';
import { LandingFooter } from './LandingFooter';
import { PRESET_VIDEOS } from '../../lib/presetVideos';

interface LandingPageProps {
  onProcess: (url: string) => Promise<void>;
  isLoading: boolean;
  loadingStep: string;
  error?: string | null;
  onRetry?: () => void;
  onOpenKeyModal: () => void;
}

const CREATOR_ITEMS = PRESET_VIDEOS.map((p) => ({ label: p.title.replace(/^.*\(([^)]+)\)$/, '$1'), url: p.url }));

/**
 * Classic hero plus sections, one action: paste a lecture link.
 * Order: hero (+ proof) -> benefits -> tagline reveal -> how it works ->
 * mechanics -> principles -> FAQ -> final CTA (same label as the hero) -> footer.
 */
export const LandingPage: React.FC<LandingPageProps> = ({
  onProcess,
  isLoading,
  loadingStep,
  error,
  onRetry,
  onOpenKeyModal,
}) => {
  const videoInputRef = useRef<VideoInputHandle>(null);

  const scrollToHero = () => {
    document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('youtube-url-input')?.focus({ preventScroll: true });
  };

  const handleSelectCreator = (url: string) => {
    videoInputRef.current?.selectPreset(url);
    scrollToHero();
  };

  return (
    <div className="landing-grid flex-1 flex flex-col">
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8">
        <VideoInput
          ref={videoInputRef}
          onProcess={onProcess}
          isLoading={isLoading}
          loadingStep={loadingStep}
          error={error}
          onRetry={onRetry}
        />
      </div>

      <CreatorStrip
        heading="Built for lectures like these"
        items={CREATOR_ITEMS}
        footnote="Works with any public YouTube lecture, not just these."
        onSelect={handleSelectCreator}
      />

      <FeatureShowcase />

      <TaglineReveal />

      <HowItWorks />

      <OutcomeStats />

      <PhilosophyQuotes />

      <LandingFaq />

      <FinalCTABand onCtaClick={scrollToHero} />

      <LandingFooter onOpenKeyModal={onOpenKeyModal} />
    </div>
  );
};
