//! Audio con los archivos reales del original (assets/audio/...ogg).
//! Rutas espejo: fx/win/*.ogg para efectos, music/win/*.ogg para musica.

use bevy::prelude::*;

#[derive(Debug, Clone, Copy)]
pub enum Sfx {
    Jump, SwimJump, Shoot, Coin, Hit, Stomp, EnemyDie, Powerup, Energy,
    Save, Key, PlayerDie, Fall,
}

impl Sfx {
    fn path(&self) -> &'static str {
        match self {
            Sfx::Jump => "audio/fx/win/jumpAir.ogg",
            Sfx::SwimJump => "audio/fx/win/jumpWater.ogg",
            Sfx::Shoot => "audio/fx/win/boomerang.ogg",
            Sfx::Coin => "audio/fx/win/coin.ogg",
            Sfx::Hit => "audio/fx/win/enemy_hit.ogg",
            Sfx::Stomp => "audio/fx/win/enemy_boomerang_hit.ogg",
            Sfx::EnemyDie => "audio/fx/win/boss_death.ogg",
            Sfx::Powerup => "audio/fx/win/extraLife.ogg",
            Sfx::Energy => "audio/fx/win/energy.ogg",
            Sfx::Save => "audio/fx/win/save.ogg",
            Sfx::Key => "audio/fx/win/key.ogg",
            Sfx::PlayerDie => "audio/fx/win/vasco_death.ogg",
            Sfx::Fall => "audio/fx/win/fall1.ogg",
        }
    }
}

pub fn play_sfx(commands: &mut Commands, assets: &AssetServer, sfx: Sfx) {
    let handle: Handle<AudioSource> = assets.load(sfx.path());
    commands.spawn((AudioPlayer(handle), PlaybackSettings::DESPAWN));
}
