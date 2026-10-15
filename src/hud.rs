//! HUD: vidas, energia, monedas, nivel, jefe, tips. UI en capa separada
//! para que cambiar texturas del mundo no rompa la interfaz.

use bevy::prelude::*;
use crate::game::{AppState, GameProgress};
use crate::level::level_def;

#[derive(Component)]
struct HudText;

#[derive(Component)]
struct BossText;

#[derive(Component)]
struct MenuText;

pub fn spawn_hud(mut commands: Commands) {
    commands.spawn((
        HudText,
        Text::new(""),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), left: Val::Px(8.0), ..default() },
    ));
    commands.spawn((
        BossText,
        Text::new(""),
        Node { position_type: PositionType::Absolute, top: Val::Px(8.0), right: Val::Px(8.0), ..default() },
    ));
    commands.spawn((
        MenuText,
        Text::new(
            "VASCOLET-WEB\n\nENTER: jugar / continuar  1-9: nivel\nFlechas moverse, doble-tap = correr\nZ/S salto (mantener = mas alto)  A/X boomerang\nAbajo agacharse  ESC/P pausa\n\nToca un checkpoint para guardar (localStorage).",
        ),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Percent(15.0), top: Val::Percent(20.0),
            ..default()
        },
    ));
}

pub fn update_hud(
    progress: Res<GameProgress>,
    state: Res<State<AppState>>,
    mut q_hud: Query<&mut Text, (With<HudText>, Without<BossText>, Without<MenuText>)>,
    mut q_boss: Query<&mut Text, (With<BossText>, Without<HudText>, Without<MenuText>)>,
    mut q_menu: Query<&mut Visibility, With<MenuText>>,
) {
    let def = level_def(progress.level);
    for mut t in &mut q_hud {
        t.0 = format!(
            "Nv {} {}  |  Vidas {}  Energia {:.0}  Monedas {}  Tip: {}",
            progress.level, def.name, progress.lives, progress.energy, progress.coins, def.tip,
        );
    }
    for mut t in &mut q_boss {
        t.0 = if progress.boss_hp > 0.0 {
            format!("JEFE {}: {:.0}/{:.0}", progress.boss_name, progress.boss_hp.max(0.0), progress.boss_max)
        } else {
            String::new()
        };
    }
    for mut v in &mut q_menu {
        *v = if *state.get() == AppState::Menu { Visibility::Visible } else { Visibility::Hidden };
    }
}
