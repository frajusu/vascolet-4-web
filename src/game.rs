//! Estado global, progresion de niveles, pausa, game over y victoria.

use bevy::prelude::*;
use crate::level::level_def;

#[derive(States, Default, Debug, Clone, PartialEq, Eq, Hash)]
pub enum AppState {
    #[default]
    Menu,
    Playing,
    Paused,
    GameOver,
    Victory,
}

#[derive(Resource)]
pub struct GameProgress {
    pub level: u32,
    pub lives: i32,
    pub energy: f32,
    pub max_energy: f32,
    pub coins: u32,
    pub unlocked: u32,
    pub checkpoint: Vec2,
    pub has_sneaker: bool,
    pub has_double_jump: bool,
    pub boss_hp: f32,
    pub boss_max: f32,
    pub boss_name: String,
}

impl Default for GameProgress {
    fn default() -> Self {
        Self {
            level: 1,
            lives: 3,
            energy: 100.0,
            max_energy: 100.0,
            coins: 0,
            unlocked: 1,
            checkpoint: Vec2::new(2.0, 2.0),
            has_sneaker: false,
            has_double_jump: false,
            boss_hp: 0.0,
            boss_max: 1.0,
            boss_name: String::new(),
        }
    }
}

#[derive(Event)]
pub struct LevelComplete;

#[derive(Event)]
pub struct PlayerDied;

#[derive(Event)]
pub struct BossDefeated(pub String);

pub fn menu_keys(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    mut progress: ResMut<GameProgress>,
) {
    if *state.get() != AppState::Menu {
        return;
    }
    if keys.just_pressed(KeyCode::Enter) {
        // Continuar desde save si existe
        if let Some(s) = crate::save::read_checkpoint() {
            progress.level = s.level.max(1).min(18);
            progress.lives = s.lives.max(1);
            progress.coins = s.coins;
            progress.unlocked = s.unlocked.max(1).min(18);
            progress.checkpoint = Vec2::new(s.x, s.y);
        }
        next.set(AppState::Playing);
    }
    // Atajos de nivel 1-9 para debug / level select rapido
    for (k, n) in [
        (KeyCode::Digit1, 1), (KeyCode::Digit2, 2), (KeyCode::Digit3, 3),
        (KeyCode::Digit4, 4), (KeyCode::Digit5, 5), (KeyCode::Digit6, 6),
        (KeyCode::Digit7, 7), (KeyCode::Digit8, 8), (KeyCode::Digit9, 9),
    ] {
        if keys.just_pressed(k) && n <= progress.unlocked {
            progress.level = n;
            next.set(AppState::Playing);
        }
    }
}

pub fn pause_keys(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
) {
    match state.get() {
        AppState::Playing if keys.just_pressed(KeyCode::Escape) || keys.just_pressed(KeyCode::KeyP) => {
            next.set(AppState::Paused);
        }
        AppState::Paused if keys.just_pressed(KeyCode::Escape) || keys.just_pressed(KeyCode::Enter) => {
            next.set(AppState::Playing);
        }
        AppState::GameOver if keys.just_pressed(KeyCode::Enter) => {
            next.set(AppState::Menu);
        }
        AppState::Victory if keys.just_pressed(KeyCode::Enter) => {
            next.set(AppState::Menu);
        }
        _ => {}
    }
}

pub fn on_level_complete(
    mut ev: EventReader<LevelComplete>,
    mut progress: ResMut<GameProgress>,
    mut next: ResMut<NextState<AppState>>,
    q_player: Query<&Transform, With<crate::player::Player>>,
) {
    for _ in ev.read() {
        progress.unlocked = progress.unlocked.max((progress.level + 1).min(18));
        crate::save::write_checkpoint(&crate::save::SaveData {
            level: progress.level.min(18),
            lives: progress.lives,
            coins: progress.coins,
            unlocked: progress.unlocked,
            x: 2.0,
            y: 2.0,
        });
        if progress.level >= 18 {
            next.set(AppState::Victory);
        } else {
            progress.level += 1;
            let def = level_def(progress.level);
            progress.checkpoint = crate::level::player_start(progress.level);
            progress.boss_hp = 0.0;
            progress.boss_name = def.boss.unwrap_or("").to_string();
            // respawn visual simple: mover jugador al inicio
            for tf in &q_player {
                let _ = tf;
            }
            next.set(AppState::Playing);
        }
    }
}

pub fn on_player_died(
    mut ev: EventReader<PlayerDied>,
    mut progress: ResMut<GameProgress>,
    mut next: ResMut<NextState<AppState>>,
    mut q_player: Query<(&mut Transform, &mut crate::player::PlayerStats)>,
) {
    for _ in ev.read() {
        progress.lives -= 1;
        if progress.lives <= 0 {
            progress.lives = 3;
            progress.coins = 0;
            next.set(AppState::GameOver);
        } else {
            progress.energy = progress.max_energy;
            for (mut tf, mut st) in &mut q_player {
                tf.translation.x = progress.checkpoint.x;
                tf.translation.y = progress.checkpoint.y;
                st.vel = Vec2::ZERO;
                st.inv_time = 2.0;
                st.jumps = 0;
            }
        }
    }
}

pub fn on_boss_defeated(
    mut ev: EventReader<BossDefeated>,
    mut complete: EventWriter<LevelComplete>,
) {
    for _ in ev.read() {
        complete.send(LevelComplete);
    }
}
