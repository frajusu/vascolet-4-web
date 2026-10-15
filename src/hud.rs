//! HUD: vidas, energia, monedas, nivel, jefe, tips. UI en capa separada
//! para que cambiar texturas del mundo no rompa la interfaz.

use bevy::prelude::*;
use crate::game::{AppState, GameProgress};
use crate::level::level_def;

#[derive(Component)]
pub struct HudText;

#[derive(Component)]
pub struct BossText;

#[derive(Component)]
pub struct MenuText;

#[derive(Component)]
pub struct TipText;

pub fn spawn_hud(mut commands: Commands) {
    commands.spawn((
        HudText,
        Text::new(""),
        TextFont { font_size: 18.0, ..default() },
        TextColor(Color::WHITE),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
    ));
    commands.spawn((
        BossText,
        Text::new(""),
        TextFont { font_size: 18.0, ..default() },
        TextColor(Color::srgb(1.0, 0.4, 0.4)),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), right: Val::Px(8.0), ..default() },
    ));
    commands.spawn((
        TipText,
        Text::new(""),
        TextFont { font_size: 20.0, ..default() },
        TextColor(Color::srgb(1.0, 0.95, 0.6)),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Percent(10.0), bottom: Val::Px(48.0),
            ..default()
        },
    ));
}

pub fn update_hud(
    progress: Res<GameProgress>,
    state: Res<State<AppState>>,
    tip: Res<crate::world::CurrentTip>,
    mut q_hud: Query<&mut Text, (With<HudText>, Without<BossText>, Without<TipText>, Without<crate::menu::MenuItem>)>,
    mut q_boss: Query<&mut Text, (With<BossText>, Without<HudText>, Without<TipText>, Without<crate::menu::MenuItem>)>,
    mut q_tip: Query<&mut Text, (With<TipText>, Without<HudText>, Without<BossText>, Without<crate::menu::MenuItem>)>,
) {
    let in_game = matches!(*state.get(), AppState::Playing | AppState::Paused);
    let def = level_def(progress.level);
    for mut t in &mut q_hud {
        t.0 = if in_game {
            format!(
                "Nv {} {}  |  Vidas {}  Energia {:.0}  Monedas {}  Llaves {}",
                progress.level, def.name, progress.lives, progress.energy, progress.coins, progress.keys,
            )
        } else {
            String::new()
        };
    }
    for mut t in &mut q_boss {
        t.0 = if in_game && progress.boss_hp > 0.0 {
            format!("JEFE {}: {:.0}/{:.0}", progress.boss_name, progress.boss_hp.max(0.0), progress.boss_max)
        } else {
            String::new()
        };
    }
    for mut t in &mut q_tip {
        t.0 = if in_game { tip.text.clone() } else { String::new() };
    }
}
