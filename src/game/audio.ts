export type SoundEffectId =
  | 'cardSelect'
  | 'cardPlay'
  | 'cardReveal'
  | 'cardDraw'
  | 'hit'
  | 'mutation';

const SOUND_EFFECTS: Record<SoundEffectId, string> = {
  cardSelect: '/assets/audio/ui/card-select.wav',
  cardPlay: '/assets/audio/ui/card-play.wav',
  cardReveal: '/assets/audio/ui/card-reveal.wav',
  cardDraw: '/assets/audio/ui/card-draw.wav',
  hit: '/assets/audio/battle/hit.wav',
  mutation: '/assets/audio/environment/mutation.wav',
};

const audioCache = new Map<SoundEffectId, HTMLAudioElement>();

export const playSoundEffect = (id: SoundEffectId, muted = false) => {
  if (muted || typeof Audio === 'undefined') return;

  try {
    let audio = audioCache.get(id);
    if (!audio) {
      audio = new Audio(SOUND_EFFECTS[id]);
      audio.preload = 'auto';
      audio.volume = 0.36;
      audioCache.set(id, audio);
    }

    const instance = audio.cloneNode(true) as HTMLAudioElement;
    instance.volume = audio.volume;
    void instance.play().catch(() => undefined);
  } catch {
    // Audio is non-critical; ignore browser autoplay or loading failures.
  }
};
