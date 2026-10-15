//! Enemigos + jefes del original (escorpion, topo ninja, pajaros, dragon,
//! bicho peludo, libelula gigante, anguila, pirana, murcielago, arana, fantasma, Malmark).
//! IA simple con delta: patrulla, persecucion, vuelo, disparo. Dano por contacto,
//! vulnerables a boomerang y pisoton (salvo puercoespin).

use bevy::prelude::*;
use crate::game::{AppState, BossDefeated, GameProgress, PlayerDied};
use crate::player::{Boomerang, Player, PlayerStats};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnemyKind {
    Scorpion, TopoNinja, Bird, GreenDragon, FurryCritter, GiantDragonfly,
    Eel, SkullPirana, LibraryBat, Spider, AngryGhost, Malmark,
    Bee, Beetle, Snail, Fish, Mosquito, Hedgehog,
}

impl EnemyKind {
    pub fn hp(&self) -> f32 {
        match self {
            EnemyKind::Malmark => 120.0, EnemyKind::GiantDragonfly => 60.0,
            EnemyKind::GreenDragon => 50.0, EnemyKind::AngryGhost => 50.0,
            EnemyKind::Spider => 40.0, EnemyKind::TopoNinja => 30.0,
            EnemyKind::Scorpion => 20.0, EnemyKind::SkullPirana => 25.0,
            EnemyKind::LibraryBat => 20.0, EnemyKind::Eel => 20.0,
            EnemyKind::FurryCritter => 15.0, EnemyKind::Bird => 8.0,
            _ => 5.0,
        }
    }
    pub fn boss(&self) -> bool {
        matches!(self,
            EnemyKind::Scorpion | EnemyKind::TopoNinja | EnemyKind::GreenDragon |
            EnemyKind::FurryCritter | EnemyKind::GiantDragonfly | EnemyKind::Eel |
            EnemyKind::SkullPirana | EnemyKind::LibraryBat | EnemyKind::Spider |
            EnemyKind::AngryGhost | EnemyKind::Malmark | EnemyKind::Bird)
    }
    pub fn color(&self) -> Color {
        match self {
            EnemyKind::Scorpion => Color::srgb(0.6, 0.3, 0.1),
            EnemyKind::TopoNinja => Color::srgb(0.3, 0.3, 0.35),
            EnemyKind::Bird => Color::srgb(0.3, 0.5, 0.9),
            EnemyKind::GreenDragon => Color::srgb(0.2, 0.7, 0.3),
            EnemyKind::FurryCritter => Color::srgb(0.7, 0.5, 0.6),
            EnemyKind::GiantDragonfly => Color::srgb(0.4, 0.8, 0.8),
            EnemyKind::Eel => Color::srgb(0.2, 0.4, 0.6),
            EnemyKind::SkullPirana => Color::srgb(0.8, 0.8, 0.8),
            EnemyKind::LibraryBat => Color::srgb(0.4, 0.2, 0.5),
            EnemyKind::Spider => Color::srgb(0.2, 0.2, 0.2),
            EnemyKind::AngryGhost => Color::srgb(0.9, 0.9, 1.0),
            EnemyKind::Malmark => Color::srgb(0.8, 0.1, 0.1),
            EnemyKind::Hedgehog => Color::srgb(0.5, 0.4, 0.2),
            _ => Color::srgb(0.5, 0.5, 0.5),
        }
    }
}

#[derive(Component)]
pub struct Enemy {
    pub kind: EnemyKind,
    pub hp: f32,
    pub dir: f32,
    pub t: f32,
    pub base_y: f32,
}

fn boss_for_level(level: u32) -> Option<EnemyKind> {
    match level {
        1 => Some(EnemyKind::Scorpion), 3 => Some(EnemyKind::TopoNinja),
        4 => Some(EnemyKind::Bird), 6 => Some(EnemyKind::FurryCritter),
        7 => Some(EnemyKind::GreenDragon), 9 => Some(EnemyKind::GiantDragonfly),
        10 => Some(EnemyKind::Eel), 12 => Some(EnemyKind::SkullPirana),
        13 => Some(EnemyKind::LibraryBat), 15 => Some(EnemyKind::Spider),
        16 => Some(EnemyKind::AngryGhost), 18 => Some(EnemyKind::Malmark),
        _ => None,
    }
}

pub fn spawn_level_enemies(commands: &mut Commands, level: u32, progress: &mut GameProgress) {
    // enemigos comunes escalonados por nivel
    let common = [
        (EnemyKind::Bee, 12.0, 1.5), (EnemyKind::Beetle, 20.0, 0.5),
        (EnemyKind::Snail, 30.0, 0.4), (EnemyKind::Fish, 45.0, -3.0),
        (EnemyKind::Mosquito, 60.0, 2.5), (EnemyKind::Hedgehog, 75.0, 0.4),
    ];
    for (kind, x, y) in common {
        // mas enemigos en niveles altos
        if (x as u32) < level * 12 + 20 {
            spawn_enemy(commands, kind, Vec2::new(x + level as f32 * 4.0, y));
        }
    }
    if let Some(boss) = boss_for_level(level) {
        let bx = crate::level::level_def(level).width_tiles as f32 * 0.45;
        spawn_enemy(commands, boss, Vec2::new(bx, 2.0));
        progress.boss_hp = boss.hp();
        progress.boss_max = boss.hp();
        progress.boss_name = format!("{:?}", boss);
    } else {
        progress.boss_hp = 0.0;
        progress.boss_name.clear();
    }
}

fn spawn_enemy(commands: &mut Commands, kind: EnemyKind, pos: Vec2) {
    let size = if kind.boss() { Vec2::new(1.6, 1.6) } else { Vec2::new(0.9, 0.9) };
    commands.spawn((
        Enemy { kind, hp: kind.hp(), dir: -1.0, t: 0.0, base_y: pos.y },
        Sprite {
            color: kind.color(),
            custom_size: Some(size),
            anchor: bevy::sprite::Anchor::BottomCenter,
            ..default()
        },
        Transform::from_translation(pos.extend(0.0)),
    ));
}

#[allow(clippy::too_many_arguments)]
pub fn enemy_ai_delta(
    time: Res<Time>,
    state: Res<State<AppState>>,
    mut progress: ResMut<GameProgress>,
    mut died: EventWriter<PlayerDied>,
    mut boss_ev: EventWriter<BossDefeated>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    q_player: Query<(&Transform, &PlayerStats), With<Player>>,
    mut q_enemy: Query<(Entity, &mut Transform, &mut Enemy), Without<Player>>,
    q_boom: Query<(&Transform, &Boomerang)>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    let dt = time.delta_secs().min(1.0 / 20.0);
    let Ok((ptf, pst)) = q_player.get_single() else { return };
    let pp = ptf.translation.truncate();

    for (e, mut tf, mut en) in &mut q_enemy {
        en.t += dt;
        let speed = match en.kind {
            EnemyKind::Bird | EnemyKind::Mosquito | EnemyKind::Bee => 3.0,
            EnemyKind::GiantDragonfly => 5.0,
            EnemyKind::AngryGhost => 2.5,
            EnemyKind::Malmark => 1.5,
            _ => 1.5,
        };
        // patrulla / persecucion / vuelo sinusoidal con delta
        match en.kind {
            EnemyKind::Bee | EnemyKind::Mosquito | EnemyKind::Bird
            | EnemyKind::GiantDragonfly | EnemyKind::LibraryBat => {
                let dir = (pp - tf.translation.truncate()).normalize_or_zero();
                tf.translation.x += dir.x * speed * dt;
                tf.translation.y += (dir.y * speed * 0.7 + (en.t * 3.0).sin() * 1.5) * dt;
            }
            EnemyKind::Fish | EnemyKind::Eel => {
                tf.translation.x += en.dir * speed * dt;
                tf.translation.y = en.base_y + (en.t * 2.0).sin() * 0.8;
                if en.t % 4.0 < dt { en.dir *= -1.0; }
            }
            _ => {
                // tierra: patrulla, persigue si el jugador esta cerca
                let dx = pp.x - tf.translation.x;
                if dx.abs() < 8.0 { en.dir = dx.signum(); }
                tf.translation.x += en.dir * speed * dt;
                if en.t % 3.0 < dt { en.dir *= -1.0; }
            }
        }

        // boomerang golpea
        for (btf, _) in &q_boom {
            if btf.translation.distance(tf.translation) < 1.0 {
                en.hp -= 5.0;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Hit);
                break;
            }
        }
        // pisoton: jugador cayendo encima (salvo puercoespin invencible)
        let stomping = pst.vel.y < -2.0 && (pp.y - tf.translation.y) > 0.8
            && (pp - tf.translation.truncate()).length() < 1.2;
        if stomping {
            if en.kind == EnemyKind::Hedgehog {
                crate::player::damage_player(&mut progress, 20.0, &mut died);
            } else {
                en.hp -= 10.0;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Stomp);
            }
        }
        // contacto dana (con invencibilidad del jugador)
        if (pp - tf.translation.truncate()).length() < 0.9 && !stomping {
            crate::player::damage_player(&mut progress, 12.0, &mut died);
        }

        // muerte
        if en.hp <= 0.0 {
            let was_boss = en.kind.boss();
            let kind = en.kind;
            commands.entity(e).despawn();
            progress.coins += if was_boss { 20 } else { 1 };
            crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::EnemyDie);
            if was_boss {
                progress.boss_hp = 0.0;
                boss_ev.send(BossDefeated(format!("{:?}", kind)));
            }
            continue;
        }
        // barra de jefe
        if en.kind.boss() {
            progress.boss_hp = en.hp;
        }
    }
}
