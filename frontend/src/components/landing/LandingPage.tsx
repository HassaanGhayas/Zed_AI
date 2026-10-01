import React, { useRef } from 'react';
import { VideoInput, type VideoInputHandle } from '../VideoInput';
import { CreatorStrip } from './CreatorStrip';
import { FeatureShowcase } from './FeatureShowcase';
import { MidCTABand } from './MidCTABand';
import { OutcomeStats } from './OutcomeStats';
import { PhilosophyQuotes } from './PhilosophyQuotes';
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
const TOPIC_ITEMS = Array.from(new Set(PRESET_VIDEOS.map((p) => p.tag))).map((tag) => ({ label: tag }));

/**
 * Marketing-style composition for the pre-session landing screen, modeled on
 * the section rhythm of a reference SaaS page (hero -> social proof ->
 * features -> CTA band -> stats -> testimonials -> social proof -> CTA ->
 * footer) but filled only with real Studify AI content.
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
        footnote="Works with any public YouTube lecture — not just these."
        onSelect={handleSelectCreator}
      />

      <FeatureShowcase />

      <MidCTABand onCtaClick={scrollToHero} />

      <OutcomeStats />

      <PhilosophyQuotes />

      <CreatorStrip heading="Popular topics" items={TOPIC_ITEMS} />

      <FinalCTABand onCtaClick={scrollToHero} />

      <LandingFooter onOpenKeyModal={onOpenKeyModal} />
    </div>
  );
};
