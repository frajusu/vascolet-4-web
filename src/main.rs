//! Vascolet-web: remake jugable para GitHub Pages.
//! - Sin limite de FPS: todo usa `delta_secs()`.
//! - Escala en UNIDADES (1 tile = 1.0): subir PNGs a HD no rompe nada.
//! - Guardado en localStorage (web) / archivo (nativo).

mod audio;
mod enemy;
mod game;
mod hud;
mod items;
mod level;
mod player;
mod save;

use bevy::prelude::*;
use game::{AppState, GameProgress};

/// Altura virtual siempre visible (en tiles). En 480p o 4K se ve lo mismo.
const VIRTUAL_H: f32 = 12.0;

fn main() {
    App::new()
        .add_plugins(
            DefaultPlugins.set(WindowPlugin {
                primary_window: Some(Window {
                    canvas: Some("#vascolet-canvas".into()),
                    fit_canvas_to_parent: true,
                    ..default()
                }),
                ..default()
            }),
        )
        .init_state::<AppState>()
        .init_resource::<GameProgress>()
        // Fondo azul oscuro: si ves este color, la app corre (negro total = wasm muerto).
        .insert_resource(ClearColor(Color::srgb(0.08, 0.11, 0.20)))
        .add_event::<game::LevelComplete>()
        .add_event::<game::PlayerDied>()
        .add_event::<game::BossDefeated>()
        .add_systems(Startup, (setup_camera, hud::spawn_hud))
        .add_systems(OnEnter(AppState::Playing), setup_level)
        .add_systems(OnExit(AppState::Playing), cleanup_level)
        .add_systems(
            Update,
            (
                game::menu_keys,
                game::pause_keys,
                fit_camera,
                player::player_move_delta,
                enemy::enemy_ai_delta,
                items::item_pickup,
                hud::update_hud,
                autosave_tick,
            ),
        )
        .add_systems(
            Update,
            (
                game::on_level_complete,
                game::on_player_died,
                game::on_boss_defeated,
            ),
        )
        .run();
}

#[derive(Component)]
struct MainCamera;

fn setup_camera(mut commands: Commands) {
    commands.spawn((
        Camera2d,
        MainCamera,
        Projection::Orthographic(OrthographicProjection {
            scale: 0.02,
            ..OrthographicProjection::default_2d()
        }),
    ));
}

/// Camara resolution-independent: ajusta el zoom para ver VIRTUAL_H tiles
/// sin importar la ventana. Cambiar texturas HD no afecta el encuadre.
fn fit_camera(
    q_win: Query<&Window>,
    mut q_cam: Query<&mut Projection, With<MainCamera>>,
    q_player: Query<&Transform, With<player::Player>>,
    mut q_cam_tf: Query<&mut Transform, With<MainCamera>>,
) {
    let Ok(win) = q_win.get_single() else { return };
    let Ok(mut proj) = q_cam.get_single_mut() else { return };
    let h = win.resolution.height().max(1.0);
    if let Projection::Orthographic(p) = &mut *proj {
        p.scale = VIRTUAL_H / h;
    }
    // follow suave al jugador
    if let (Ok(pp), Ok(mut cp)) = (q_player.get_single(), q_cam_tf.get_single_mut()) {
        cp.translation.x += (pp.translation.x - cp.translation.x) * 0.1;
        cp.translation.y += ((pp.translation.y + 2.0).max(3.0) - cp.translation.y) * 0.1;
    }
}

fn setup_level(
    mut commands: Commands,
    mut progress: ResMut<GameProgress>,
) {
    // jugador + enemigos + items del nivel actual
    player::spawn_player(&mut commands, &progress);
    enemy::spawn_level_enemies(&mut commands, progress.level, &mut progress);
    items::spawn_level_items(&mut commands, progress.level);
}

fn cleanup_level(
    mut commands: Commands,
    q: Query<Entity, Or<(With<player::Player>, With<enemy::Enemy>, With<items::Item>, With<player::Boomerang>)>>,
) {
    for e in &q {
        commands.entity(e).despawn_recursive();
    }
}

fn autosave_tick(
    time: Res<Time>,
    mut timer: Local<f32>,
    player: Query<&Transform, With<player::Player>>,
    progress: Res<GameProgress>,
    state: Res<State<AppState>>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    *timer += time.delta_secs();
    if *timer > 5.0 {
        *timer = 0.0;
        if let Ok(tf) = player.get_single() {
            save::write_checkpoint(&save::SaveData {
                level: progress.level,
                lives: progress.lives,
                coins: progress.coins,
                unlocked: progress.unlocked,
                x: tf.translation.x,
                y: tf.translation.y,
            });
        }
    }
}
