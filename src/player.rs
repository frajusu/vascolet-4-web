//! Jugador: fisica con delta, salto (sostenido + coyote + buffer), doble salto,
//! correr (doble-tap / zapatilla), agacharse, nadar, disparar boomerangs, dano con invencibilidad.

use bevy::prelude::*;
use crate::game::{AppState, GameProgress, PlayerDied};

#[derive(Component)]
pub struct Player;

#[derive(Component)]
pub struct PlayerStats {
    pub vel: Vec2,
    pub jumps: u8,
    pub on_ground: bool,
    pub coyote: f32,
    pub jump_buffer: f32,
    pub inv_time: f32,
    pub ducking: bool,
    pub facing: f32,
    pub last_tap_dir: f32,
    pub last_tap_time: f32,
    pub running: bool,
    pub fire_cd: f32,
    pub in_water: bool,
}

impl Default for PlayerStats {
    fn default() -> Self {
        Self {
            vel: Vec2::ZERO, jumps: 0, on_ground: false, coyote: 0.0,
            jump_buffer: 0.0, inv_time: 0.0, ducking: false, facing: 1.0,
            last_tap_dir: 0.0, last_tap_time: -10.0, running: false,
            fire_cd: 0.0, in_water: false,
        }
    }
}

#[derive(Component)]
pub struct Boomerang {
    pub vel: Vec2,
    pub life: f32,
    pub returning: bool,
}

const GRAVITY: f32 = 24.0;
const MOVE_SPEED: f32 = 6.0;
const RUN_SPEED: f32 = 9.5;
const JUMP_VEL: f32 = 9.0;
const SWIM_UP: f32 = 5.0;

pub fn spawn_player(commands: &mut Commands, progress: &GameProgress) {
    commands.spawn((
        Player,
        PlayerStats::default(),
        Sprite {
            color: Color::srgb(0.95, 0.35, 0.2),
            custom_size: Some(Vec2::new(0.9, 1.2)),
            anchor: bevy::sprite::Anchor::BottomCenter,
            ..default()
        },
        Transform::from_translation(progress.checkpoint.extend(0.0)),
    ));
}

#[allow(clippy::too_many_arguments)]
pub fn player_move_delta(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut progress: ResMut<GameProgress>,
    mut died: EventWriter<PlayerDied>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut q: Query<(Entity, &mut Transform, &mut PlayerStats), With<Player>>,
    mut q_boom: Query<(Entity, &mut Transform, &mut Boomerang), Without<Player>>,
) {
    if *state.get() != AppState::Playing {
        return;
    }
    let dt = time.delta_secs().min(1.0 / 20.0);
    let t_now = time.elapsed_secs();

    for (_e, mut tf, mut st) in &mut q {
        // --- input horizontal + doble-tap para correr ---
        let mut dir = 0.0;
        if keys.pressed(KeyCode::ArrowLeft) { dir -= 1.0; }
        if keys.pressed(KeyCode::ArrowRight) { dir += 1.0; }
        if dir != 0.0 {
            for key in [KeyCode::ArrowLeft, KeyCode::ArrowRight] {
                if keys.just_pressed(key) {
                    let d = if key == KeyCode::ArrowLeft { -1.0 } else { 1.0 };
                    if st.last_tap_dir == d && t_now - st.last_tap_time < 0.3 {
                        st.running = true;
                    }
                    st.last_tap_dir = d;
                    st.last_tap_time = t_now;
                }
            }
            st.facing = dir;
        } else {
            st.running = false;
        }
        if progress.has_sneaker {
            st.running = true;
        }
        let speed = if st.running { RUN_SPEED } else { MOVE_SPEED };
        // Agua = mas lento en X
        let speed = if st.in_water { speed * 0.6 } else { speed };
        st.vel.x = dir * speed;

        // --- agacharse ---
        st.ducking = keys.pressed(KeyCode::ArrowDown);

        // --- salto con buffer + coyote + sostenido + doble salto ---
        let jump_pressed = keys.just_pressed(KeyCode::KeyZ) || keys.just_pressed(KeyCode::KeyS);
        if jump_pressed {
            st.jump_buffer = 0.12;
        } else {
            st.jump_buffer = (st.jump_buffer - dt).max(0.0);
        }
        st.coyote = if st.on_ground { 0.1 } else { (st.coyote - dt).max(0.0) };

        let can_jump = st.coyote > 0.0 && st.jump_buffer > 0.0;
        let can_double = progress.has_double_jump && st.jumps < 2 && st.jump_buffer > 0.0 && !st.on_ground;
        if can_jump || can_double {
            st.vel.y = JUMP_VEL;
            st.jumps += 1;
            st.jump_buffer = 0.0;
            st.coyote = 0.0;
            st.on_ground = false;
            crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Jump);
        }
        // salto sostenido: si suelta rapido, corta la subida
        if !keys.pressed(KeyCode::KeyZ) && !keys.pressed(KeyCode::KeyS) && st.vel.y > 3.0 && !st.in_water {
            st.vel.y = 3.0;
        }
        // agua: impulsarse con salto
        if st.in_water && (keys.pressed(KeyCode::KeyZ) || keys.pressed(KeyCode::KeyS)) {
            st.vel.y = SWIM_UP;
        }

        // --- gravedad con delta ---
        if !st.in_water {
            st.vel.y -= GRAVITY * dt;
        } else {
            st.vel.y -= GRAVITY * 0.3 * dt;
            st.vel.y = st.vel.y.clamp(-4.0, SWIM_UP);
        }

        // --- integrar ---
        tf.translation.x += st.vel.x * dt;
        tf.translation.y += st.vel.y * dt;

        // --- piso provisorio (el terreno real del TMX viene en level) ---
        st.in_water = tf.translation.y < -2.0 && tf.translation.y > -6.0;
        if tf.translation.y < 0.0 && !st.in_water {
            if st.vel.y < -18.0 {
                damage_player(&mut progress, 10.0, &mut died);
            }
            tf.translation.y = 0.0;
            st.vel.y = 0.0;
            st.on_ground = true;
            st.jumps = 0;
        } else if tf.translation.y > 0.05 {
            st.on_ground = false;
        }

        // --- disparo boomerang con delta cooldown ---
        st.fire_cd = (st.fire_cd - dt).max(0.0);
        if (keys.just_pressed(KeyCode::KeyA) || keys.just_pressed(KeyCode::KeyX)) && st.fire_cd <= 0.0 {
            st.fire_cd = 0.35;
            let dir = st.facing;
            commands.spawn((
                Boomerang { vel: Vec2::new(dir * 12.0, 2.0), life: 2.0, returning: false },
                Sprite {
                    color: Color::srgb(0.9, 0.8, 0.3),
                    custom_size: Some(Vec2::splat(0.5)),
                    ..default()
                },
                Transform::from_translation(tf.translation + Vec3::new(dir * 0.6, 0.8, 0.0)),
            ));
            crate::audio::play_sfx(&mut commands, &asset_server, crate::audio::Sfx::Shoot);
        }

        // --- timers ---
        st.inv_time = (st.inv_time - dt).max(0.0);

        // --- caida al vacio = muerte ---
        if tf.translation.y < -12.0 {
            died.write(PlayerDied);
        }

        // --- fin de nivel provisorio: llegar lejos a la derecha ---
        if tf.translation.x > crate::level::level_def(progress.level).width_tiles as f32 * 0.5 {
            // el jefe debe estar derrotado si el nivel tiene uno
            if progress.boss_hp <= 0.0 {
                // se emite desde enemy.rs al derrotar jefe; aqui solo niveles sin jefe
                if crate::level::level_def(progress.level).boss.is_none() {
                    // evitar spam: solo una vez
                    progress.checkpoint.x = tf.translation.x;
                }
            }
        }
    }

    // --- boomerangs con delta ---
    for (e, mut tf, mut b) in &mut q_boom {
        b.life -= dt;
        if b.life <= 0.0 {
            commands.entity(e).despawn();
            continue;
        }
        // ida y vuelta simple
        if b.life < 1.0 {
            b.returning = true;
        }
        let dir = if b.returning { -b.vel.x.signum() } else { b.vel.x.signum() };
        tf.translation.x += dir * 12.0 * dt;
        tf.rotate_z(8.0 * dt);
    }
}

pub fn damage_player(progress: &mut GameProgress, amount: f32, died: &mut EventWriter<PlayerDied>) {
    progress.energy -= amount;
    if progress.energy <= 0.0 {
        progress.energy = progress.max_energy;
        died.write(PlayerDied);
    }
}
