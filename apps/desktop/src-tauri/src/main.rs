#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "--invoke" {
        let cmd = &args[2];
        let payload = if args.len() >= 4 { &args[3] } else { "{}" };
        match xerservice_desktop_lib::dispatch_cli_command(cmd, payload) {
            Ok(output) => {
                println!("{}", output);
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("{}", e);
                std::process::exit(1);
            }
        }
    }

    xerservice_desktop_lib::run();
}
