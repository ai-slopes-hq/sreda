//! FOLD's curves (spec §7a, revision 27): each periodic and zero-mean, with a periodic antiderivative for ADAA.

use crate::shaping::Curve;
use std::f64::consts::FRAC_PI_2;

/// SINE: sin(π/2·u) — peaks at u = ±1, then folds back smoothly.
pub struct Sine;
impl Curve for Sine {
    fn f(u: f64) -> f64 {
        (FRAC_PI_2 * u).sin()
    }
    fn big_f(u: f64) -> f64 {
        -(FRAC_PI_2 * u).cos() / FRAC_PI_2
    }
}

/// v = ((u + 1) mod 4) − 2, in [−2, 2)
fn tri_phase(u: f64) -> f64 {
    (u + 1.0).rem_euclid(4.0) - 2.0
}

/// TRI: a triangle wave of u — straight up to ±1 at u = ±1, straight back down, period 4.
pub struct Tri;
impl Curve for Tri {
    fn f(u: f64) -> f64 {
        1.0 - tri_phase(u).abs()
    }
    fn big_f(u: f64) -> f64 {
        let v = tri_phase(u);
        v - 0.5 * v * v.abs()
    }
}

/// WRAP: u wrapped into [−1, 1) — leaves one edge, comes back at the other.
pub struct Wrap;
impl Curve for Wrap {
    fn f(u: f64) -> f64 {
        (u + 1.0).rem_euclid(2.0) - 1.0
    }
    fn big_f(u: f64) -> f64 {
        let w = Self::f(u);
        0.5 * w * w
    }
}

/// CHEB: Σ wₙ·Tₙ(x) for n = 1…16, x the input softly held inside ±1; `n` (1…16, fractional) is how many harmonics
/// sound, each new one fading in. Tₙ by the recurrence T₍ₙ₊₁₎ = 2x·Tₙ − T₍ₙ₋₁₎.
pub fn cheb(x: f64, n: f64) -> f64 {
    let x = x.tanh();
    let (mut t0, mut t1) = (1.0, x);
    let mut y = t1;
    for k in 2..=16 {
        let t2 = 2.0 * x * t1 - t0;
        let w = (n - (k as f64 - 1.0)).clamp(0.0, 1.0) / (k as f64).sqrt();
        y += w * t2;
        t0 = t1;
        t1 = t2;
    }
    y
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check<C: Curve>(name: &str) {
        for i in -900..900 {
            let u = i as f64 * 0.01 + 0.003;
            let h = 1e-5;
            // skip WRAP's jumps
            if name == "wrap"
                && ((u + 1.0).rem_euclid(2.0) < 2e-5 || (u + 1.0).rem_euclid(2.0) > 2.0 - 2e-5)
            {
                continue;
            }
            let d = (C::big_f(u + h) - C::big_f(u - h)) / (2.0 * h);
            assert!(
                (d - C::f(u)).abs() < 1e-3,
                "{name} at {u}: {d} vs {}",
                C::f(u)
            );
        }
    }

    #[test]
    fn each_antiderivative_matches_its_curve_and_is_continuous() {
        check::<Sine>("sine");
        check::<Tri>("tri");
        check::<Wrap>("wrap");
        // periodic antiderivatives have no jumps
        for u in [-3.0, -1.0, 1.0, 3.0] {
            assert!((Tri::big_f(u - 1e-9) - Tri::big_f(u + 1e-9)).abs() < 1e-6);
            assert!((Wrap::big_f(u - 1e-9) - Wrap::big_f(u + 1e-9)).abs() < 1e-6);
        }
    }

    #[test]
    fn cheb_with_one_harmonic_is_the_input_held() {
        assert!((cheb(0.5, 1.0) - 0.5f64.tanh()).abs() < 1e-12);
        assert!(cheb(0.9, 16.0).is_finite());
    }
}
