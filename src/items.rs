//! Items: monedas, corazones/vida, cereales/energia, llaves y puertas,
//! zapatilla (correr), resorte (doble salto), checkpoints de guardado.

use bevy::prelude::*;
use crate::game::{AppState, GameProgress};
use crate::player::Player;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Coin, Heart, Cereal, BlueKey, RedKey, GreenKey, Sneaker, Spring, Checkpoint,
}

#[derive(Component)]
pub struct Item {
    pub kind: ItemKind,
    pub t: f32,
}

#[derive(Component)]
pub struct Door {
    pub open: bool,
}

pub fn spawn_level_items(commands: &mut Commands, level: u32) {
    let spots = [
        (ItemKind::Coin, 8.0, 1.0), (ItemKind::Coin, 9.0, 1.0),
        (ItemKind::Coin, 10.0, 1.0), (ItemKind::Heart, 15.0, 1.0),
        (ItemKind::Cereal, 25.0, 1.0), (ItemKind::Checkpoint, 40.0, 0.5),
    ];
    for (kind, x, y) in spots {
        spawn_item(commands, kind, Vec2::new(x + level as f32 * 2.0, y));
    }
    // powerups progresivos como en el original
    if level == 1 {
        spawn_item(commands, ItemKind::Sneaker, Vec2::new(50.0, 1.0));
    }
    if level == 4 {
        spawn_item(commands, ItemKind::Spring, Vec2::new(55.0, 1.0));
    }
    if level >= 2 {
        spawn_item(commands, ItemKind::BlueKey, Vec2::new(20.0, 2.0));
    }
    if level >= 8 {
        spawn_item(commands, ItemKind::RedKey, Vec2::new(35.0, 2.0));
    }
    if level >= 12 {
        spawn_item(commands, ItemKind::GreenKey, Vec2::new(45.0, 2.0));
    }
}

fn spawn_item(commands: &mut Commands, kind: ItemKind, pos: Vec2) {
    let (color, size) = match kind {
        ItemKind::Coin => (Color::srgb(1.0, 0.85, 0.2), Vec2::splat(0.5)),
        ItemKind::Heart => (Color::srgb(1.0, 0.2, 0.3), Vec2::splat(0.6)),
        ItemKind::Cereal => (Color::srgb(0.9, 0.7, 0.3), Vec2::splat(0.6)),
        ItemKind::BlueKey => (Color::srgb(0.2, 0.4, 1.0), Vec2::splat(0.6)),
        ItemKind::RedKey => (Color::srgb(1.0, 0.2, 0.2), Vec2::splat(0.6)),
        ItemKind::GreenKey => (Color::srgb(0.2, 0.9, 0.3), Vec2::splat(0.6)),
        ItemKind::Sneaker => (Color::srgb(0.9, 0.9, 0.9), Vec2::splat(0.7)),
        ItemKind::Spring => (Color::srgb(0.5, 0.9, 0.5), Vec2::splat(0.7)),
        ItemKind::Checkpoint => (Color::srgb(0.3, 1.0, 0.5), Vec2::new(0.6, 1.2)),
    };
    commands.spawn((
        Item { kind, t: 0.0 },
        Sprite { color, custom_size: Some(size), ..default() },
        Transform::from_translation(pos.extend(0.0)),
    ));
}

pub fn item_pickup(
    time: Res<Time>,
    state: Res<State<AppState>>,
    mut progress: ResMut<GameProgress>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    q_player: Query<&Transform, With<Player>>,
    mut q_item: Query<(Entity, &mut Transform, &mut Item)>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    let dt = time.delta_secs().min(1.0 / 20.0);
    let Ok(ptf) = q_player.get_single() else { return };
    let pp = ptf.translation.truncate();

    for (e, mut tf, mut it) in &mut q_item {
        it.t += dt;
        // flotacion con delta
        tf.translation.y += (it.t * 3.0).sin() * 0.3 * dt;
        if (pp - tf.translation.truncate()).length() > 1.0 {
            continue;
        }
        match it.kind {
            ItemKind::Coin => {
                progress.coins += 1;
                if progress.coins % 50 == 0 {
                    progress.lives += 1; // vida extra cada 50 monedas
                }
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Coin);
            }
            ItemKind::Heart => {
                progress.energy = (progress.energy + 30.0).min(progress.max_energy);
                progress.lives += 1;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::Cereal => {
                progress.energy = (progress.energy + 20.0).min(progress.max_energy);
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::Sneaker => {
                progress.has_sneaker = true;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::Spring => {
                progress.has_double_jump = true;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::Checkpoint => {
                progress.checkpoint = tf.translation.truncate();
                crate::save::write_checkpoint(&crate::save::SaveData {
                    level: progress.level, lives: progress.lives, coins: progress.coins,
                    unlocked: progress.unlocked, x: progress.checkpoint.x, y: progress.checkpoint.y,
                });
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Save);
                continue; // el checkpoint no se consume
            }
            _ => {
                progress.coins += 2;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Coin);
            }
        }
        commands.entity(e).despawn();
    }
}
