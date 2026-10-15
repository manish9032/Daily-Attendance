import React from 'react';
import { FlowerSpecies, PlantHealthState, PlantStage } from '../types';
import { getPlantStageFromCycleDay } from '../lib/networkTime';

interface PlantIllustrationProps {
  cycleDay: number;
  flowerType: FlowerSpecies;
  health: PlantHealthState;
  isWatering: boolean;
  size?: 'md' | 'lg';
}

const FLOWER_PALETTES: Record<
  FlowerSpecies,
  { petals: string; petalsInner: string; center: string; badgeBg: string }
> = {
  Sunflower: {
    petals: '#FACC15',
    petalsInner: '#EAB308',
    center: '#713F12',
    badgeBg: '#FEF9C3',
  },
  Rose: {
    petals: '#F43F5E',
    petalsInner: '#E11D48',
    center: '#881337',
    badgeBg: '#FFE4E6',
  },
  Lotus: {
    petals: '#F472B6',
    petalsInner: '#EC4899',
    center: '#FDE047',
    badgeBg: '#FCE7F3',
  },
  Orchid: {
    petals: '#A855F7',
    petalsInner: '#9333EA',
    center: '#FEF08A',
    badgeBg: '#F3E8FF',
  },
};

export const PlantIllustration: React.FC<PlantIllustrationProps> = ({
  cycleDay,
  flowerType,
  health,
  isWatering,
  size = 'lg',
}) => {
  const stage: PlantStage = getPlantStageFromCycleDay(cycleDay);
  const palette = FLOWER_PALETTES[flowerType] || FLOWER_PALETTES.Sunflower;
  const isWilted = health === 'wilted';

  const stemColor = isWilted ? '#D97706' : '#16A34A';
  const leafColor = isWilted ? '#F59E0B' : '#22C55E';
  const leafDarkColor = isWilted ? '#B45309' : '#15803D';

  const containerDimensions =
    size === 'lg' ? 'w-60 h-60 sm:w-64 sm:h-64' : 'w-44 h-44';

  return (
    <div
      className={`relative mx-auto flex items-center justify-center select-none ${containerDimensions}`}
      aria-label={`${flowerType} plant at ${stage} stage (${health})`}
    >
      {/* Subtle Sunlit Halo */}
      <div
        className={`absolute inset-4 rounded-full transition-colors duration-500 ${
          isWilted
            ? 'bg-amber-100/70'
            : isWatering
            ? 'bg-sky-100/80'
            : 'bg-emerald-100/60'
        }`}
      />

      {/* Watering Can & Falling Droplets Animation */}
      {isWatering && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <svg viewBox="0 0 260 260" className="w-full h-full">
            {/* Watering Can Spout in Top Right */}
            <g transform="translate(152, 14) rotate(-22)">
              <rect x="20" y="12" width="44" height="32" rx="8" fill="#0284C7" />
              <path
                d="M20 26 L-8 38 L-4 44 L20 36 Z"
                fill="#0369A1"
              />
              <ellipse cx="-8" cy="41" rx="4" ry="6" fill="#38BDF8" />
              <path
                d="M44 12 C56 0, 74 10, 64 28"
                stroke="#0284C7"
                strokeWidth="5"
                fill="none"
              />
            </g>
            {/* Animated Water Droplets */}
            <g className="animate-water-drop-1">
              <path
                d="M126 62 C126 62 120 72 120 76 C120 79.3 122.7 82 126 82 C129.3 82 132 79.3 132 76 C132 72 126 62 126 62 Z"
                fill="#0EA5E9"
              />
            </g>
            <g className="animate-water-drop-2">
              <path
                d="M112 72 C112 72 107 80 107 84 C107 87 109.2 89 112 89 C114.8 89 117 87 117 84 C117 80 112 72 112 72 Z"
                fill="#38BDF8"
              />
            </g>
            <g className="animate-water-drop-3">
              <path
                d="M140 70 C140 70 135 78 135 82 C135 85 137.2 87 140 87 C142.8 87 145 85 145 82 C145 78 140 70 140 70 Z"
                fill="#0284C7"
              />
            </g>
          </svg>
        </div>
      )}

      <svg
        viewBox="0 0 260 260"
        className={`relative z-10 w-full h-full transition-transform duration-500 ${
          isWatering ? 'scale-105' : 'scale-100'
        }`}
      >
        {/* Ground Shadow */}
        <ellipse cx="130" cy="236" rx="64" ry="10" fill="#111C18" opacity="0.08" />

        {/* Plant Growth Stage Artwork */}
        <g
          transform={
            isWilted
              ? 'translate(8, 6) rotate(5, 130, 175)'
              : 'translate(0, 0)'
          }
        >
          {/* STAGE 1: SEED */}
          {stage === 'Seed' && (
            <g>
              {/* Soil Mound */}
              <path
                d="M95 174 Q130 156 165 174 Z"
                fill="#78350F"
              />
              {/* Glowing Seed Nestled in Soil */}
              <ellipse
                cx="130"
                cy="165"
                rx="12"
                ry="8"
                transform="rotate(-15 130 165)"
                fill="#F59E0B"
                stroke="#78350F"
                strokeWidth="2.5"
              />
              <path
                d="M128 160 Q132 152 136 156"
                stroke="#22C55E"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          )}

          {/* STAGE 2: SPROUT */}
          {stage === 'Sprout' && (
            <g>
              <path d="M95 174 Q130 158 165 174 Z" fill="#78350F" />
              <path
                d="M130 170 Q130 142 130 128"
                stroke={stemColor}
                strokeWidth="6"
                strokeLinecap="round"
                fill="none"
              />
              {/* Left Cotyledon Leaf */}
              <path
                d="M130 136 C108 136 96 122 102 108 C116 108 130 120 130 136 Z"
                fill={leafColor}
              />
              {/* Right Cotyledon Leaf */}
              <path
                d="M130 132 C152 132 164 118 158 104 C144 104 130 116 130 132 Z"
                fill={leafDarkColor}
              />
            </g>
          )}

          {/* STAGE 3: SAPLING */}
          {stage === 'Sapling' && (
            <g>
              <path d="M95 174 Q130 158 165 174 Z" fill="#78350F" />
              <path
                d="M130 170 C128 144 132 118 130 92"
                stroke={stemColor}
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
              />
              {/* Lower Leaves */}
              <path
                d="M130 146 C102 146 86 128 92 110 C112 112 128 128 130 146 Z"
                fill={leafDarkColor}
              />
              <path
                d="M130 138 C158 138 174 120 168 102 C148 104 132 120 130 138 Z"
                fill={leafColor}
              />
              {/* Upper Leaves */}
              <path
                d="M130 112 C108 110 98 94 104 80 C120 82 130 96 130 112 Z"
                fill={leafColor}
              />
              <path
                d="M130 106 C152 104 162 88 156 74 C140 76 130 90 130 106 Z"
                fill={leafDarkColor}
              />
            </g>
          )}

          {/* STAGE 4: BUD */}
          {stage === 'Bud' && (
            <g>
              <path d="M95 174 Q130 158 165 174 Z" fill="#78350F" />
              <path
                d="M130 170 C127 136 133 108 130 76"
                stroke={stemColor}
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
              />
              {/* Lush Leaves */}
              <path
                d="M130 148 C98 148 82 128 88 108 C110 110 128 128 130 148 Z"
                fill={leafDarkColor}
              />
              <path
                d="M130 136 C162 136 178 116 172 96 C150 98 132 116 130 136 Z"
                fill={leafColor}
              />
              <path
                d="M130 112 C106 110 94 94 100 78 C118 80 128 96 130 112 Z"
                fill={leafColor}
              />
              {/* Swelling Flower Bud */}
              <circle cx="130" cy="68" r="18" fill={palette.petalsInner} />
              <path
                d="M114 74 Q130 44 146 74 Z"
                fill={palette.petals}
              />
              <path
                d="M112 76 Q130 88 148 76"
                stroke={leafDarkColor}
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          )}

          {/* STAGE 5: FULL BLOOM */}
          {stage === 'Full Bloom' && (
            <g>
              <path d="M95 174 Q130 158 165 174 Z" fill="#78350F" />
              <path
                d="M130 170 C126 134 134 104 130 72"
                stroke={stemColor}
                strokeWidth="8.5"
                strokeLinecap="round"
                fill="none"
              />
              {/* Full Stem Leaves */}
              <path
                d="M130 150 C96 150 78 128 84 106 C108 108 128 128 130 150 Z"
                fill={leafDarkColor}
              />
              <path
                d="M130 138 C164 138 182 116 176 94 C152 96 132 116 130 138 Z"
                fill={leafColor}
              />
              <path
                d="M130 114 C104 112 92 94 98 78 C116 80 128 96 130 114 Z"
                fill={leafColor}
              />
              <path
                d="M130 108 C156 106 168 88 162 72 C144 74 132 90 130 108 Z"
                fill={leafDarkColor}
              />

              {/* Flower Crown Petals (12 Radial Petals) */}
              <g transform="translate(130, 64)">
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(
                  (angle) => (
                    <ellipse
                      key={angle}
                      cx="0"
                      cy="-24"
                      rx="10"
                      ry="18"
                      transform={`rotate(${angle})`}
                      fill={angle % 60 === 0 ? palette.petals : palette.petalsInner}
                    />
                  )
                )}
                <circle cx="0" cy="0" r="18" fill={palette.center} />
                <circle
                  cx="-5"
                  cy="-5"
                  r="4"
                  fill="#FFFFFF"
                  opacity="0.35"
                />
              </g>
            </g>
          )}
        </g>

        {/* Terracotta Planter Pot */}
        <g>
          {/* Pot Body */}
          <path
            d="M84 178 H176 L164 232 C162.5 237 158 240 152 240 H108 C102 240 97.5 237 96 232 Z"
            fill="#C2410C"
          />
          {/* Pot Highlight */}
          <path
            d="M92 180 H112 L106 236 H102 Z"
            fill="#EA580C"
            opacity="0.45"
          />
          {/* Pot Rim */}
          <rect
            x="76"
            y="166"
            width="108"
            height="16"
            rx="6"
            fill="#EA580C"
          />
          {/* Subtle Rim Stripe */}
          <line
            x1="84"
            y1="174"
            x2="176"
            y2="174"
            stroke="#FB923C"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
};
