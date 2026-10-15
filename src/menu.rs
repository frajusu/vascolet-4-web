//! Menus como el original: Jugar, Continuar, Niveles, Logros, Opciones,
//! Ayuda, Creditos (+ pausa, game over y victoria).
//! Fondos con las imagenes GUI originales. Navegacion por teclado.

use bevy::prelude::*;
use bevy::ui::ImageNode;
use crate::game::{AppState, GameProgress};
use crate::hud::{BossText, HudText, TipText};
use crate::level::LEVELS;

#[derive(Component)]
struct ScreenRoot;

#[derive(Component)]
pub struct MenuItem {
    pub index: usize,
    pub label: String,
}

#[derive(Resource, Default)]
pub struct MenuNav {
    pub index: usize,
}

fn bg(commands: &mut Commands, assets: &AssetServer, path: &str) {
    commands.spawn((
        ScreenRoot,
        ImageNode {
            image: assets.load(path),
            ..default()
        },
        Node {
            width: Val::Percent(100.0),
            height: Val::Percent(100.0),
            position_type: PositionType::Absolute,
            ..default()
        },
    ));
}

fn title(commands: &mut Commands, text: &str, top_pct: f32, size: f32) {
    commands.spawn((
        ScreenRoot,
        Text::new(text),
        TextFont { font_size: size, ..default() },
        TextColor(Color::WHITE),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Percent(10.0),
            top: Val::Percent(top_pct),
            ..default()
        },
    ));
}

type HlQuery<'w> = Query<
    'w,
    'w,
    (&'w MenuItem, &'w mut Text, &'w mut TextColor),
    (
        Without<HudText>,
        Without<BossText>,
        Without<TipText>,
        Without<crate::hud::MenuText>,
    ),
>;

fn paint(q: &mut HlQuery, sel: usize) {
    for (item, mut t, mut c) in q {
        if item.index == sel {
            t.0 = format!("> {}", item.label);
            *c = TextColor(Color::srgb(1.0, 0.85, 0.3));
        } else {
            t.0 = format!("  {}", item.label);
            *c = TextColor(Color::WHITE);
        }
    }
}

fn spawn_item(commands: &mut Commands, index: usize, label: &str, sel: bool, left: f32, top: f32, size: f32) {
    commands.spawn((
        ScreenRoot,
        MenuItem { index, label: label.to_string() },
        Text::new(if sel { format!("> {}", label) } else { format!("  {}", label) }),
        TextFont { font_size: size, ..default() },
        TextColor(if sel { Color::srgb(1.0, 0.85, 0.3) } else { Color::WHITE }),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Percent(left),
            top: Val::Percent(top),
            ..default()
        },
    ));
}

fn clear_screen(commands: &mut Commands, q: &Query<Entity, With<ScreenRoot>>) {
    for e in q {
        commands.entity(e).despawn_recursive();
    }
}

fn has_save() -> bool {
    crate::save::read_checkpoint().is_some()
}

fn menu_labels() -> Vec<&'static str> {
    let mut labels = vec!["Jugar"];
    if has_save() {
        labels.push("Continuar");
    }
    labels.extend(["Niveles", "Logros", "Opciones", "Ayuda", "Creditos"]);
    labels
}

// ---------- Menu principal ----------

pub fn enter_menu(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut nav: ResMut<MenuNav>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    nav.index = 0;
    bg(&mut commands, &assets, "gui/menu/background.jpg");
    title(&mut commands, "VASCOLET 4", 8.0, 64.0);
    title(&mut commands, "remake web - homenaje al original", 22.0, 20.0);
    for (i, label) in menu_labels().iter().enumerate() {
        spawn_item(&mut commands, i, label, i == 0, 12.0, 34.0 + 7.0 * i as f32, 24.0);
    }
}

pub fn nav_menu(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    mut nav: ResMut<MenuNav>,
    mut progress: ResMut<GameProgress>,
    mut q_hl: HlQuery,
) {
    if *state.get() != AppState::Menu {
        return;
    }
    let labels = menu_labels();
    let count = labels.len();
    if keys.just_pressed(KeyCode::ArrowUp) {
        nav.index = nav.index.checked_sub(1).unwrap_or(count - 1);
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::ArrowDown) {
        nav.index = (nav.index + 1) % count;
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::Enter) {
        match labels[nav.index] {
            "Jugar" => {
                progress.level = 1;
                progress.lives = 3;
                progress.coins = 0;
                progress.energy = progress.max_energy;
                progress.has_sneaker = false;
                progress.has_double_jump = false;
                progress.has_sustain = false;
                progress.has_jump_attack = false;
                progress.boomerang_level = 0;
                progress.keys = 0;
                next.set(AppState::Playing);
            }
            "Continuar" => {
                if let Some(s) = crate::save::read_checkpoint() {
                    progress.level = s.level.max(1).min(18);
                    progress.lives = s.lives.max(1);
                    progress.coins = s.coins;
                    progress.unlocked = s.unlocked.max(1).min(18);
                    progress.checkpoint = Vec2::new(s.x, s.y);
                }
                next.set(AppState::Playing);
            }
            "Niveles" => next.set(AppState::LevelSelect),
            "Logros" => next.set(AppState::Achievements),
            "Opciones" => next.set(AppState::Options),
            "Ayuda" => next.set(AppState::Help),
            "Creditos" => next.set(AppState::Credits),
            _ => {}
        }
    }
}

// ---------- Seleccion de niveles ----------

pub fn enter_levels(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut nav: ResMut<MenuNav>,
    progress: Res<GameProgress>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    nav.index = (progress.level as usize).saturating_sub(1).min(17);
    bg(&mut commands, &assets, "gui/menu/background.jpg");
    title(&mut commands, "NIVELES  (ESC: volver)", 5.0, 44.0);
    for l in LEVELS.iter() {
        let i = (l.n - 1) as usize;
        let col = if i < 9 { 8.0 } else { 52.0 };
        let row = i % 9;
        let label = if l.n <= progress.unlocked {
            format!("{}. {}", l.n, l.name)
        } else {
            format!("{}. ???", l.n)
        };
        spawn_item(&mut commands, i, &label, i == nav.index, col, 18.0 + 7.0 * row as f32, 20.0);
    }
}

pub fn nav_levels(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    mut nav: ResMut<MenuNav>,
    mut progress: ResMut<GameProgress>,
    mut q_hl: HlQuery,
) {
    if *state.get() != AppState::LevelSelect {
        return;
    }
    if keys.just_pressed(KeyCode::ArrowUp) {
        nav.index = nav.index.checked_sub(1).unwrap_or(17);
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::ArrowDown) {
        nav.index = (nav.index + 1) % 18;
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::ArrowLeft) || keys.just_pressed(KeyCode::ArrowRight) {
        nav.index = (nav.index + 9) % 18;
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::Escape) {
        next.set(AppState::Menu);
        return;
    }
    if keys.just_pressed(KeyCode::Enter) {
        let n = nav.index as u32 + 1;
        if n <= progress.unlocked {
            progress.level = n;
            next.set(AppState::Playing);
        }
    }
}

// ---------- Ayuda / Creditos / Logros ----------

pub fn enter_help(
    mut commands: Commands,
    assets: Res<AssetServer>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    bg(&mut commands, &assets, "gui/help/help.jpg");
    title(&mut commands, "AYUDA", 6.0, 48.0);
    title(
        &mut commands,
        "Flechas: moverse (doble-tap = correr)\nZ/S: saltar (mantener = mas alto)\nA/X: boomerang   Abajo: agacharse\nESC/P: pausa   Toca checkpoints para guardar\n\nVegetales = vida, frutas = disparo,\ncereales = energia. Cuidado con el erizo.",
        20.0,
        22.0,
    );
    title(&mut commands, "ESC: volver", 82.0, 22.0);
}

pub fn enter_credits(
    mut commands: Commands,
    assets: Res<AssetServer>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    bg(&mut commands, &assets, "gui/credits/credits.jpg");
    title(&mut commands, "CREDITOS", 6.0, 48.0);
    title(
        &mut commands,
        "Vascolet 4 (original) y todos sus assets pertenecen a sus autores.\nRemake web no oficial hecho con Rust + Bevy por fans,\ncon fines educativos y de preservacion.\n\nMusica, niveles y personajes del juego original.",
        20.0,
        22.0,
    );
    title(&mut commands, "ESC: volver", 82.0, 22.0);
}

pub fn enter_achievements(
    mut commands: Commands,
    assets: Res<AssetServer>,
    progress: Res<GameProgress>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    bg(&mut commands, &assets, "images/achievements/background.jpg");
    title(&mut commands, "LOGROS", 6.0, 48.0);
    let lines = [
        format!("Nivel maximo desbloqueado: {}/18", progress.unlocked),
        format!("Monedas de la partida: {}", progress.coins),
        if progress.unlocked >= 18 { "Juego completado: SI".to_string() } else { "Juego completado: ...".to_string() },
        if progress.has_sneaker { "Zapatillas: SI".to_string() } else { "Zapatillas: ...".to_string() },
        if progress.has_double_jump { "Doble salto: SI".to_string() } else { "Doble salto: ...".to_string() },
    ];
    for (i, l) in lines.iter().enumerate() {
        title(&mut commands, l, 20.0 + 6.0 * i as f32, 22.0);
    }
    title(&mut commands, "ESC: volver", 82.0, 22.0);
}

pub fn back_to_menu(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
) {
    match state.get() {
        AppState::Help | AppState::Credits | AppState::Achievements | AppState::Options => {
            if keys.just_pressed(KeyCode::Escape) {
                next.set(AppState::Menu);
            }
        }
        _ => {}
    }
}

// ---------- Opciones ----------

pub fn enter_options(
    mut commands: Commands,
    assets: Res<AssetServer>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    bg(&mut commands, &assets, "gui/menu/background.jpg");
    refresh_options(&mut commands, crate::save::read_settings().volume);
}

fn refresh_options(commands: &mut Commands, vol: f32) {
    title(commands, "OPCIONES", 6.0, 48.0);
    let bars = (vol * 10.0).round() as usize;
    title(
        commands,
        &format!(
            "Volumen: [{}{}]  (Izq/Der)\n\nESC: volver",
            "#".repeat(bars),
            "-".repeat(10 - bars)
        ),
        24.0,
        24.0,
    );
}

pub fn nav_options(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    mut commands: Commands,
    mut volume: ResMut<bevy::audio::GlobalVolume>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    if *state.get() != AppState::Options {
        return;
    }
    if keys.just_pressed(KeyCode::Escape) {
        next.set(AppState::Menu);
        return;
    }
    let mut s = crate::save::read_settings();
    let mut dirty = false;
    if keys.just_pressed(KeyCode::ArrowLeft) {
        s.volume = (s.volume - 0.1).max(0.0);
        dirty = true;
    }
    if keys.just_pressed(KeyCode::ArrowRight) {
        s.volume = (s.volume + 0.1).min(1.0);
        dirty = true;
    }
    if dirty {
        crate::save::write_settings(&s);
        volume.volume = bevy::audio::Volume::Linear(s.volume);
        clear_screen(&mut commands, &q);
        refresh_options(&mut commands, s.volume);
    }
}

// ---------- Pausa ----------

pub fn enter_pause(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut nav: ResMut<MenuNav>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    nav.index = 0;
    bg(&mut commands, &assets, "gui/menu/background.jpg");
    title(&mut commands, "PAUSA", 10.0, 56.0);
    for (i, label) in ["Continuar", "Reiniciar nivel", "Salir al menu"].iter().enumerate() {
        spawn_item(&mut commands, i, label, i == 0, 12.0, 34.0 + 8.0 * i as f32, 24.0);
    }
}

#[allow(clippy::too_many_arguments)]
pub fn nav_pause(
    keys: Res<ButtonInput<KeyCode>>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    mut nav: ResMut<MenuNav>,
    mut progress: ResMut<GameProgress>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut grid: ResMut<crate::world::SolidGrid>,
    mut texts: ResMut<crate::world::TextsDb>,
    mut music: ResMut<crate::world::LevelMusic>,
    mut info: ResMut<crate::world::LevelInfo>,
    mut tip: ResMut<crate::world::CurrentTip>,
    mut q_hl: HlQuery,
    q_screen: Query<Entity, With<ScreenRoot>>,
    q_old: Query<
        Entity,
        Or<(
            With<crate::world::TileSprite>,
            With<crate::world::TriggerInfo>,
            With<crate::world::TriggerSave>,
            With<crate::world::MusicMarker>,
            With<crate::player::Player>,
            With<crate::enemy::Enemy>,
            With<crate::items::Item>,
            With<crate::player::Boomerang>,
        )>,
    >,
) {
    if *state.get() != AppState::Paused {
        return;
    }
    if keys.just_pressed(KeyCode::ArrowUp) {
        nav.index = nav.index.checked_sub(1).unwrap_or(2);
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::ArrowDown) {
        nav.index = (nav.index + 1) % 3;
        paint(&mut q_hl, nav.index);
    }
    if keys.just_pressed(KeyCode::Enter) {
        match nav.index {
            0 => next.set(AppState::Playing),
            1 => {
                crate::world::cleanup_level(&mut commands, &q_old);
                crate::world::setup_level(
                    &mut commands, &asset_server, &mut progress,
                    &mut grid, &mut texts, &mut music, &mut info, &mut tip,
                );
                next.set(AppState::Playing);
            }
            _ => {
                crate::world::cleanup_level(&mut commands, &q_old);
                clear_screen(&mut commands, &q_screen);
                next.set(AppState::Menu);
            }
        }
    }
}

// ---------- Game over / victoria ----------

pub fn enter_gameover(
    mut commands: Commands,
    assets: Res<AssetServer>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    bg(&mut commands, &assets, "gui/gameover/gameover.png");
    title(&mut commands, "GAME OVER", 60.0, 56.0);
    title(&mut commands, "ENTER: volver al menu", 76.0, 24.0);
}

pub fn enter_victory(
    mut commands: Commands,
    assets: Res<AssetServer>,
    progress: Res<GameProgress>,
    q: Query<Entity, With<ScreenRoot>>,
) {
    clear_screen(&mut commands, &q);
    bg(&mut commands, &assets, "gui/win/win.png");
    title(&mut commands, "¡GANASTE!", 55.0, 56.0);
    title(
        &mut commands,
        &format!("Derrotaste a Malmark con {} monedas. ENTER: menu", progress.coins),
        72.0,
        24.0,
    );
}

pub fn exit_screens(mut commands: Commands, q: Query<Entity, With<ScreenRoot>>) {
    clear_screen(&mut commands, &q);
}
