import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '../ui/Card';
import { Reveal } from './Reveal';

const FAQ_ITEMS = [
  {
    q: 'Which videos does it work with?',
    a: 'Any public YouTube video that has captions or an automatic transcript. Private and members only videos cannot be read.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. Sessions are saved in your browser. Signing in with Google is optional and adds cloud sync and a daily review queue of concepts due for another try.',
  },
  {
    q: 'Do I need my own Gemini API key?',
    a: 'Only if the server has no key configured. You can add your own from Manage API key in the footer, and it overrides the server key for your requests.',
  },
  {
    q: 'Can I skip ahead without answering?',
    a: 'No. The player pauses at the end of each chapter and keeps the next one locked until you resolve the checkpoint question.',
  },
  {
    q: 'What happens when my answer is wrong?',
    a: 'Your answer is graded as correct, a misconception, or incorrect. For a misconception, the tutor names what broke, points back to the lecture, and asks again.',
  },
  {
    q: 'What goes into the PDF notes?',
    a: 'The lecture transcript merged with your questions and the explanations you gave, compiled into a PDF you can download.',
  },
  {
    q: 'What happens to my data?',
    a: 'Local storage is the primary store. If you sign in, sessions sync to your account, and you can delete your cloud data at any time.',
  },
] as const;

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};

export const LandingFaq: React.FC = () => (
  <section className="max-w-3xl mx-auto px-4 py-14 sm:py-20" aria-labelledby="faq-heading">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    <h2 id="faq-heading" className="text-center font-display text-2xl sm:text-3xl font-bold text-ink mb-10 text-balance">
      Questions before you start
    </h2>
    <div className="space-y-3">
      {FAQ_ITEMS.map((item, idx) => (
        <Reveal key={item.q} delay={Math.min(idx, 3) * 80}>
          <Card radius="lg" className="hover:border-accent/30 transition-[border-color] duration-200">
            <details className="group">
              <summary className="flex items-center justify-between gap-4 min-h-[44px] px-5 py-3 cursor-pointer list-none rounded-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <span className="text-balance">{item.q}</span>
                <ChevronDown
                  className="w-4 h-4 flex-shrink-0 text-ink-faint transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="px-5 pb-4 text-sm text-ink-muted text-pretty">{item.a}</p>
            </details>
          </Card>
        </Reveal>
      ))}
    </div>
  </section>
);
