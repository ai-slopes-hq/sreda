//! DRIVE's curves (spec §7a, revision 26): each a memoryless shape with its antiderivative for first-order ADAA.

use crate::shaping::Curve;

/// SOFT: a soft sine — sin(πx/2) inside ±1, flat outside.
pub struct SoftSine;
impl Curve for SoftSine {
    fn f(x: f64) -> f64 {
        if x.abs() <= 1.0 {
            (std::f64::consts::FRAC_PI_2 * x).sin()
        } else {
            x.signum()
        }
    }
    fn big_f(x: f64) -> f64 {
        if x.abs() <= 1.0 {
            -(std::f64::consts::FRAC_PI_2 * x).cos() / std::f64::consts::FRAC_PI_2
        } else {
            x.abs() - 1.0
        }
    }
}

/// TUBE: a triode-like asymmetric curve — gentle above zero (x / (1 + x)), harder below (tanh of 2x, halved).
pub struct Triode;
impl Curve for Triode {
    fn f(x: f64) -> f64 {
        if x >= 0.0 {
            x / (1.0 + x)
        } else {
            0.5 * (2.0 * x).tanh()
        }
    }
    fn big_f(x: f64) -> f64 {
        if x >= 0.0 {
            x - x.ln_1p()
        } else {
            // ∫ 0.5·tanh(2x) dx = ln cosh(2x) / 4
            let a = (2.0 * x).abs();
            (a + (-2.0 * a).exp().ln_1p() - std::f64::consts::LN_2) / 4.0
        }
    }
}

/// OD, and the clipping stage of the others: tanh, a symmetric diode pair.
pub use crate::shaping::Tanh as Diode;

/// DIST / DIGI: a hard clip at ±1.
pub use crate::shaping::Clip as Hard;

/// FUZZ: an asymmetric hard clip — +1 above, −0.45 below (a starved, biased transistor).
pub struct Starved;
const LOW: f64 = 0.45;
impl Curve for Starved {
    fn f(x: f64) -> f64 {
        x.clamp(-LOW, 1.0)
    }
    fn big_f(x: f64) -> f64 {
        if x > 1.0 {
            x - 0.5
        } else if x < -LOW {
            -LOW * x - 0.5 * LOW * LOW
        } else {
            0.5 * x * x
        }
    }
}

/// RECT: half-wave plus `a` of the negative half flipped (a = 0 half-wave, a = 1 full-wave). Not a `Curve` (it has a
/// parameter): its antiderivative is computed in place.
pub fn rect(x: f64, a: f64) -> f64 {
    if x >= 0.0 {
        x
    } else {
        -a * x
    }
}
pub fn rect_big_f(x: f64, a: f64) -> f64 {
    if x >= 0.0 {
        0.5 * x * x
    } else {
        -0.5 * a * x * x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check<C: Curve>(name: &str) {
        for i in -400..400 {
            let x = i as f64 * 0.01;
            let h = 1e-5;
            let d = (C::big_f(x + h) - C::big_f(x - h)) / (2.0 * h);
            assert!(
                (d - C::f(x)).abs() < 1e-3,
                "{name} at {x}: {d} vs {}",
                C::f(x)
            );
        }
    }

    #[test]
    fn each_antiderivative_matches_its_curve() {
        check::<SoftSine>("soft");
        check::<Triode>("triode");
        check::<Starved>("starved");
        for a in [0.0, 0.5, 1.0] {
            for i in -300..300 {
                let x = i as f64 * 0.01;
                let d = (rect_big_f(x + 1e-5, a) - rect_big_f(x - 1e-5, a)) / 2e-5;
                assert!((d - rect(x, a)).abs() < 1e-3);
            }
        }
    }
}
