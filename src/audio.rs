//! Audio: carga los .ogg originales si existen en assets/, si no, no rompe.
//! Rutas espejo del original: assets/audio/fx/win/*.ogg

use bevy::prelude::*;

#[derive(Debug, Clone, Copy)]
pub enum Sfx {
    Jump, Shoot, Coin, Hit, Stomp, EnemyDie, Powerup, Save,
}

impl Sfx {
    fn path(&self) -> &'static str {
        match self {
            Sfx::Jump => "audio/fx/win/double_jump.ogg",
            Sfx::Shoot => "audio/fx/win/boomerang.ogg",
            Sfx::Coin => "audio/fx/win/coin.ogg",
            Sfx::Hit => "audio/fx/win/enemy_hit.ogg",
            Sfx::Stomp => "audio/fx/win/enemy_boomerang_hit.ogg",
            Sfx::EnemyDie => "audio/fx/win/boss_death.ogg",
            Sfx::Powerup => "audio/fx/win/extraLife.ogg",
            Sfx::Save => "audio/fx/win/save.ogg",
        }
    }
}

pub fn play_sfx(commands: &mut Commands, assets: &AssetServer, sfx: Sfx) {
    let handle: Handle<AudioSource> = assets.load(sfx.path());
    commands.spawn((AudioPlayer(handle), PlaybackSettings::DESPAWN));
}
