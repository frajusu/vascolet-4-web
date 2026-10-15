//! Items exactos del original (grupo Items del TMX): &Life (vida),
//! &P-SustainJump (salto mayor), &P-JumpAttack (pisoton), &B-Item (boomerang),
//! &Key (llave), Energy / FullEnergy.

use bevy::prelude::*;
use crate::game::{AppState, GameProgress};
use crate::player::Player;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Coin, Heart, Cereal, FullEnergy, Key, Sneaker, Spring,
    SustainJump, JumpAttack, BoomerangUp, Checkpoint,
}

#[derive(Component)]
pub struct Item {
    pub kind: ItemKind,
    pub t: f32,
}

pub fn spawn_item_kind(commands: &mut Commands, kind: ItemKind, pos: Vec2) {
    let (color, size) = match kind {
        ItemKind::Coin => (Color::srgb(1.0, 0.85, 0.2), Vec2::splat(0.5)),
        ItemKind::Heart => (Color::srgb(1.0, 0.2, 0.3), Vec2::splat(0.6)),
        ItemKind::Cereal => (Color::srgb(0.9, 0.7, 0.3), Vec2::splat(0.6)),
        ItemKind::FullEnergy => (Color::srgb(1.0, 0.5, 0.1), Vec2::splat(0.7)),
        ItemKind::Key => (Color::srgb(0.2, 0.4, 1.0), Vec2::splat(0.6)),
        ItemKind::Sneaker => (Color::srgb(0.9, 0.9, 0.9), Vec2::splat(0.7)),
        ItemKind::Spring => (Color::srgb(0.5, 0.9, 0.5), Vec2::splat(0.7)),
        ItemKind::SustainJump => (Color::srgb(0.6, 1.0, 0.6), Vec2::splat(0.7)),
        ItemKind::JumpAttack => (Color::srgb(1.0, 0.6, 0.2), Vec2::splat(0.7)),
        ItemKind::BoomerangUp => (Color::srgb(1.0, 0.9, 0.3), Vec2::splat(0.6)),
        ItemKind::Checkpoint => (Color::srgb(0.3, 1.0, 0.5), Vec2::new(0.6, 1.2)),
    };
    commands.spawn((
        Item { kind, t: 0.0 },
        Sprite { color, custom_size: Some(size), ..default() },
        Transform::from_translation(pos.extend(3.0)),
    ));
}

pub fn item_pickup(
    time: Res<Time>,
    state: Res<State<AppState>>,
    mut progress: ResMut<GameProgress>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    q_player: Query<&Transform, With<Player>>,
    mut q_item: Query<(Entity, &mut Transform, &mut Item), Without<Player>>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    let dt = time.delta_secs().min(1.0 / 20.0);
    let Ok(ptf) = q_player.get_single() else { return };
    let pp = ptf.translation.truncate();

    for (e, mut tf, mut it) in &mut q_item {
        it.t += dt;
        tf.translation.y += (it.t * 3.0).sin() * 0.3 * dt;
        if (pp - tf.translation.truncate()).length() > 1.0 {
            continue;
        }
        match it.kind {
            ItemKind::Coin => {
                progress.coins += 1;
                if progress.coins % 50 == 0 {
                    progress.lives += 1;
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
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Energy);
            }
            ItemKind::FullEnergy => {
                progress.energy = progress.max_energy;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Energy);
            }
            ItemKind::Key => {
                progress.keys += 1;
                progress.coins += 5;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Key);
            }
            ItemKind::Sneaker => {
                progress.has_sneaker = true;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::Spring => {
                progress.has_double_jump = true;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::SustainJump => {
                progress.has_sustain = true;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::JumpAttack => {
                progress.has_jump_attack = true;
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::BoomerangUp => {
                progress.boomerang_level = (progress.boomerang_level + 1).min(3);
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Powerup);
            }
            ItemKind::Checkpoint => {
                progress.checkpoint = tf.translation.truncate();
                crate::save::write_checkpoint(&crate::save::SaveData {
                    level: progress.level, lives: progress.lives, coins: progress.coins,
                    unlocked: progress.unlocked, x: progress.checkpoint.x, y: progress.checkpoint.y,
                });
                crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Save);
                continue;
            }
        }
        commands.entity(e).despawn();
    }
}
