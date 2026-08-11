export const STOCK_VOICES = [
  { id: "alba", name: "Alba", description: "Warm, clear and conversational", tone: "Warm" },
  { id: "marius", name: "Marius", description: "Measured, low and assured", tone: "Deep" },
  { id: "javert", name: "Javert", description: "Authoritative with a dramatic edge", tone: "Firm" },
  { id: "jean", name: "Jean", description: "Friendly and naturally expressive", tone: "Natural" },
  { id: "fantine", name: "Fantine", description: "Soft, intimate and emotional", tone: "Soft" },
  { id: "cosette", name: "Cosette", description: "Bright and youthful", tone: "Bright" },
  { id: "eponine", name: "Eponine", description: "Rich, textured and confident", tone: "Rich" },
  { id: "azelma", name: "Azelma", description: "Light, agile and playful", tone: "Light" },
];

export type StockVoice = (typeof STOCK_VOICES)[number];
