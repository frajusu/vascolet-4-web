//! Enemigos exactos del original (nombres del TMX): Fly, Frog, Flower, Beetle,
//! Snail, BigScorpion, TopoNinja, BigBird, BigSnake, VolcanoFlower, Panal, Bat,
//! LittleSpider, BigBat, BigGhost, BigSpider, BigAnguila, Piranha, Pirana2,
//! Blowfish, BigPiranaBlowFish, Shell, BigPirana, Fork, Knife, Mouse, Mosquito,
//! DragonFly, Bee, GiantDragonfly, BigUglyDragon, FurryCritter, Axe,
//! FrontColumn, SideColumn, Malmark (Circle/?).
//! IA con delta: patrulla, persecucion, vuelo, acuaticos, peligros fijos,
//! columnas aplastantes. Dano por contacto, boomerang y pisoton (con item).

use bevy::prelude::*;
use crate::game::{AppState, BossDefeated, GameProgress, PlayerDied};
use crate::player::{Boomerang, Player, PlayerStats};
use crate::world::{collide_move, SolidGrid};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnemyKind {
    Fly, Frog, Flower, Beetle, Snail, BigScorpion, TopoNinja, BigBird, BigSnake,
    VolcanoFlower, Panal, Bat, LittleSpider, BigBat, BigGhost, BigSpider,
    BigAnguila, Piranha, Pirana2, Blowfish, BigPiranaBlowFish, Shell, BigPirana,
    Fork, Knife, Mouse, Mosquito, DragonFly, Bee, GiantDragonfly,
    BigUglyDragon, FurryCritter, Axe, FrontColumn, SideColumn, Malmark,
}

/// (kind, es_jefe)
pub fn enemy_kind_from_tmx(name: &str) -> Option<(EnemyKind, bool)> {
    use EnemyKind::*;
    let bossy = matches!(
        name,
        "BigScorpion" | "TopoNinja" | "BigBat" | "BigGhost" | "BigSpider"
            | "BigAnguila" | "BigPirana" | "BigUglyDragon" | "GiantDragonfly"
            | "FurryCritter" | "Circle" | "?"
    );
    let kind = match name {
        "Fly" => Fly, "Frog" => Frog, "Flower" => Flower, "Beetle" => Beetle,
        "Snail" => Snail, "BigScorpion" => BigScorpion, "TopoNinja" => TopoNinja,
        "BigBird" => BigBird, "BigSnake" => BigSnake, "VolcanoFlower" => VolcanoFlower,
        "Panal" => Panal, "Bat" => Bat, "LittleSpider" => LittleSpider,
        "BigBat" => BigBat, "BigGhost" => BigGhost, "BigSpider" => BigSpider,
        "BigAnguila" => BigAnguila, "Piranha" => Piranha, "Pirana2" => Pirana2,
        "Blowfish" => Blowfish, "BigPiranaBlowFish" => BigPiranaBlowFish,
        "Shell" => Shell, "BigPirana" => BigPirana, "Fork" => Fork,
        "Knife" => Knife, "Mouse" => Mouse, "Mosquito" => Mosquito,
        "DragonFly" => DragonFly, "Bee" => Bee, "GiantDragonfly" => GiantDragonfly,
        "BigUglyDragon" => BigUglyDragon, "FurryCritter" => FurryCritter,
        "Axe" => Axe, "FrontColumn" => FrontColumn, "SideColumn" => SideColumn,
        "Circle" | "?" => Malmark,
        _ => return None,
    };
    // BigBird/BigSnake en manada tambien cuentan como jefes de su nivel
    let bossy = bossy || matches!(kind, BigBird | BigSnake);
    Some((kind, bossy))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Behavior {
    Flyer, Walker, Aquatic, Hazard, Crusher,
}

fn behavior(kind: EnemyKind) -> Behavior {
    use EnemyKind::*;
    match kind {
        Fly | Bee | Mosquito | DragonFly | Bat | GiantDragonfly | BigGhost => Behavior::Flyer,
        Flower | VolcanoFlower | Fork | Knife | Axe | Panal => Behavior::Hazard,
        FrontColumn | SideColumn => Behavior::Crusher,
        Piranha | Pirana2 | Blowfish | BigPiranaBlowFish | BigAnguila | BigPirana => Behavior::Aquatic,
        _ => Behavior::Walker,
    }
}

impl EnemyKind {
    pub fn hp(&self) -> f32 {
        use EnemyKind::*;
        match self {
            Malmark => 140.0, BigUglyDragon => 70.0, GiantDragonfly => 60.0,
            BigGhost => 55.0, BigSpider => 45.0, BigBat => 40.0,
            TopoNinja => 35.0, BigAnguila | BigPirana => 35.0,
            BigPiranaBlowFish => 25.0, BigScorpion => 25.0, BigBird => 20.0,
            BigSnake => 18.0, FurryCritter => 15.0, Panal => 12.0,
            FrontColumn | SideColumn => 9999.0, // indestructibles
            _ => 6.0,
        }
    }
    pub fn color(&self) -> Color {
        use EnemyKind::*;
        match self {
            BigScorpion => Color::srgb(0.6, 0.3, 0.1),
            TopoNinja => Color::srgb(0.3, 0.3, 0.35),
            Malmark => Color::srgb(0.85, 0.1, 0.1),
            GiantDragonfly => Color::srgb(0.4, 0.8, 0.8),
            BigGhost => Color::srgb(0.9, 0.9, 1.0),
            Flower | VolcanoFlower => Color::srgb(0.9, 0.2, 0.4),
            Fork | Knife | Axe => Color::srgb(0.75, 0.75, 0.8),
            FrontColumn | SideColumn => Color::srgb(0.5, 0.5, 0.55),
            Panal => Color::srgb(0.85, 0.7, 0.2),
            _ => Color::srgb(0.45, 0.55, 0.45),
        }
    }
    pub fn size(&self) -> Vec2 {
        use EnemyKind::*;
        match self {
            Malmark | BigUglyDragon | GiantDragonfly | BigGhost => Vec2::new(1.8, 1.8),
            BigScorpion | TopoNinja | BigBat | BigSpider | BigAnguila | BigPirana
            | BigBird | BigSnake | BigPiranaBlowFish | FurryCritter => Vec2::new(1.5, 1.5),
            FrontColumn => Vec2::new(1.0, 3.0),
            SideColumn => Vec2::new(1.0, 2.0),
            _ => Vec2::new(0.9, 0.9),
        }
    }
}

#[derive(Component)]
pub struct Enemy {
    pub kind: EnemyKind,
    pub boss: bool,
    pub hp: f32,
    pub dir: f32,
    pub t: f32,
    pub base_y: f32,
    pub vy: f32,
    pub spawn_t: f32,
}

pub fn spawn_enemy_kind(commands: &mut Commands, kind: EnemyKind, pos: Vec2) {
    use EnemyKind::*;
    let boss = matches!(
        kind,
        BigScorpion | TopoNinja | BigBat | BigGhost | BigSpider | BigAnguila
            | BigPirana | BigUglyDragon | GiantDragonfly | FurryCritter
            | BigBird | BigSnake | Malmark
    );
    commands.spawn((
        Enemy { kind, boss, hp: kind.hp(), dir: -1.0, t: 0.0, base_y: pos.y, vy: 0.0, spawn_t: 0.0 },
        Sprite {
            color: kind.color(),
            custom_size: Some(kind.size()),
            anchor: bevy::sprite::Anchor::BottomCenter,
            ..default()
        },
        Transform::from_translation(pos.extend(4.0)),
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
    grid: Res<SolidGrid>,
    q_player: Query<(&Transform, &PlayerStats), With<Player>>,
    mut q_enemy: Query<(Entity, &mut Transform, &mut Enemy), Without<Player>>,
    q_boom: Query<&Boomerang>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    let dt = time.delta_secs().min(1.0 / 20.0);
    let Ok((ptf, pst)) = q_player.get_single() else { return };
    let pp = ptf.translation.truncate();
    let boom_dmg = 5.0 + 2.0 * progress.boomerang_level as f32;

    // barra de jefe: el maximo hp entre jefes vivos
    let mut top_boss: Option<(String, f32, f32)> = None;
    // abejas vivas (para que el Panal no spawnee sin limite); se cuenta antes
    // del loop mutable para no pedir prestada la query dos veces.
    let bees = q_enemy.iter().filter(|(_, _, x)| x.kind == EnemyKind::Bee).count();

    for (e, mut tf, mut en) in &mut q_enemy {
        en.t += dt;
        let speed = match behavior(en.kind) {
            Behavior::Flyer => 3.2,
            Behavior::Aquatic => 2.4,
            Behavior::Crusher => 0.8,
            Behavior::Hazard => 0.0,
            Behavior::Walker => 1.6,
        };
        match behavior(en.kind) {
            Behavior::Flyer => {
                let dir = (pp - tf.translation.truncate()).normalize_or_zero();
                let chase = if en.boss { 1.0 } else { 0.4 };
                tf.translation.x += dir.x * speed * chase * dt;
                tf.translation.y += (dir.y * speed * 0.5 * chase + (en.t * 3.0).sin() * 1.2) * dt;
            }
            Behavior::Aquatic => {
                let dir = (pp - tf.translation.truncate()).normalize_or_zero();
                tf.translation.x += dir.x.min(1.0).max(-1.0) * speed * dt * en.dir.signum().abs().max(0.5);
                tf.translation.y = en.base_y + (en.t * 2.0).sin() * 0.8;
                if en.t % 4.0 < dt {
                    en.dir *= -1.0;
                }
            }
            Behavior::Crusher => {
                // columnas que patrullan y aplastan
                let prev_bottom = tf.translation.y - en.kind.size().y * 0.5;
                let dx = en.dir * speed * dt;
                let (np, hit_x, _, _, _) = collide_move(
                    tf.translation.truncate(),
                    en.kind.size() * 0.5,
                    Vec2::new(dx, 0.0),
                    prev_bottom,
                    &grid,
                );
                tf.translation.x = np.x;
                if hit_x || en.t % 5.0 < dt {
                    en.dir *= -1.0;
                }
            }
            Behavior::Hazard => {
                // Panal genera abejas
                if en.kind == EnemyKind::Panal {
                    en.spawn_t += dt;
                    if en.spawn_t > 6.0 {
                        en.spawn_t = 0.0;
                        if bees < 3 {
                            spawn_enemy_kind(&mut commands, EnemyKind::Bee, tf.translation.truncate() + Vec2::Y);
                        }
                    }
                }
            }
            Behavior::Walker => {
                let dx = pp.x - tf.translation.x;
                if dx.abs() < 8.0 {
                    en.dir = dx.signum();
                }
                en.vy -= 24.0 * dt;
                let prev_bottom = tf.translation.y - en.kind.size().y * 0.5;
                let (np, hit_x, grounded, _, _) = collide_move(
                    tf.translation.truncate(),
                    en.kind.size() * 0.5,
                    Vec2::new(en.dir * speed * dt, en.vy * dt),
                    prev_bottom,
                    &grid,
                );
                tf.translation.x = np.x;
                tf.translation.y = np.y;
                if grounded {
                    en.vy = 0.0;
                }
                if hit_x {
                    en.dir *= -1.0;
                }
            }
        }

        // boomerang golpea (columnas inmunes)
        if en.kind != EnemyKind::FrontColumn && en.kind != EnemyKind::SideColumn {
            for b in &q_boom {
                if b.pos.distance(tf.translation) < 1.0 {
                    en.hp -= boom_dmg;
                    crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Hit);
                    break;
                }
            }
        }
        // pisoton con item JumpAttack (salvo erizo/peligros fijos/columnas)
        let stomping = pst.vel.y < -2.0
            && (pp.y - tf.translation.y) > 0.6
            && (pp - tf.translation.truncate()).length() < 1.3;
        if stomping {
            match en.kind {
                EnemyKind::FrontColumn | EnemyKind::SideColumn | EnemyKind::Flower
                | EnemyKind::VolcanoFlower | EnemyKind::Fork | EnemyKind::Knife
                | EnemyKind::Axe => {
                    crate::player::damage_player(&mut progress, 20.0, &mut died);
                }
                _ if progress.has_jump_attack => {
                    en.hp -= 12.0;
                    crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Stomp);
                }
                _ => {
                    crate::player::damage_player(&mut progress, 12.0, &mut died);
                }
            }
        }
        // contacto dana
        if (pp - tf.translation.truncate()).length() < 0.9 && !stomping {
            crate::player::damage_player(&mut progress, 12.0, &mut died);
        }

        if en.hp <= 0.0 {
            let was_boss = en.boss;
            let kind = en.kind;
            commands.entity(e).despawn();
            progress.coins += if was_boss { 20 } else { 1 };
            crate::audio::play_sfx(
                &mut commands,
                &asset_server,
                if was_boss { crate::audio::Sfx::EnemyDie } else { crate::audio::Sfx::Hit },
            );
            if was_boss {
                progress.boss_hp = 0.0;
                boss_ev.send(BossDefeated(format!("{:?}", kind)));
            }
            continue;
        }
        if en.boss {
            let label = format!("{:?}", en.kind);
            if top_boss.as_ref().map(|(_, hp, _)| *hp).unwrap_or(-1.0) < en.hp {
                top_boss = Some((label, en.hp, en.kind.hp()));
            }
        }
    }

    if let Some((name, hp, max)) = top_boss {
        progress.boss_hp = hp;
        progress.boss_max = max;
        progress.boss_name = name;
    } else {
        progress.boss_hp = 0.0;
    }
}
