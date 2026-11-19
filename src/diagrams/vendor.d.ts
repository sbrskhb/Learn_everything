declare module 'wavedrom' {
  export type WaveSkin = unknown;
  export function renderAny(
    index: number,
    source: Record<string, any>,
    waveSkin: WaveSkin,
    notFirstSignal?: boolean,
    notFirstAssign?: boolean
  ): any[];
  export const waveSkin: WaveSkin;
  export const version: string;
}

declare module 'onml' {
  export function stringify(ml: any[], indent?: number): string;
  export function parse(xml: string): any[];
  export function traverse(ml: any[], callbacks: Record<string, any>): void;
}
