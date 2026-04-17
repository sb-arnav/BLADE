// src/lib/animation.ts
// Mathematical foundation for fluid UI animations in React.
// Provides precise bezier curves mimicking Arc & Linear standards.

export class AnimationUtils {
  
  // Standard CSS transitions tailored for Blade
  static readonly curves = {
    // Quick pop-ins and hover states
    fast: "cubic-bezier(0.16, 1, 0.3, 1)", 
    // Slide ins, modal reveals
    smooth: "cubic-bezier(0.22, 1, 0.36, 1)", 
    // Exits and dismissals 
    easeIn: "cubic-bezier(0.4, 0, 1, 1)",   
    // High-energy bounces
    spring: "cubic-bezier(0.175, 0.885, 0.32, 1.275)" 
  };

  /**
   * Spring physics based on stiffness and damping (a la framer-motion)
   * Formula derived from harmonic oscillator equations
   * Only used if manually bridging web animations JS API
   */
  static generateSpringKeyframes(
    from: number, 
    to: number, 
    stiffness: number = 100, 
    damping: number = 10
  ): number[] {
    const keyframes: number[] = [];
    let p = from;
    let v = 0;
    const delta = 1/60; // 60fps simulation step
    const frames = 60; // simulating 1 sec
    
    for(let i=0; i<frames; i++) {
        // F = -kx - cv
        const force = -stiffness * (p - to) - damping * v;
        const acceleration = force; // mass=1
        v += acceleration * delta;
        p += v * delta;
        keyframes.push(p);
    }
    return keyframes;
  }

  /**
   * Convenience builder for tailwind transition classes
   */
  static cxFadeIn(durationMs: number = 200, delayMs: number = 0): string {
    return `transition-all duration-${durationMs} delay-${delayMs} ease-out`;
  }
}
