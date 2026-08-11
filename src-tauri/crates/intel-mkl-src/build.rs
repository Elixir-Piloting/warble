// MIT License
//
// Copyright (c) 2017 Toshiki Teramura
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use anyhow::Result;
use intel_mkl_tool::*;
use std::str::FromStr;

// WARBLE FORK: force the single-threaded (seq) static config regardless of
// which MKL feature(s) the dependency graph enables (candle-core/candle-nn
// hard-require `mkl-static-lp64-iomp`). The stock iomp package only ships an
// import library for libiomp5md.dll, which is not present on disk, so apps
// fail to launch with STATUS_DLL_NOT_FOUND (0xc0000135). `seq` links fully
// statically and needs no runtime DLL.
const MKL_CONFIG: &str = "mkl-static-lp64-seq";

fn main() -> Result<()> {
    let cfg = Config::from_str(MKL_CONFIG).unwrap();
    if let Ok(lib) = Library::new(cfg) {
        lib.print_cargo_metadata()?;
        return Ok(());
    }

    // Try ocipkg for static library.
    //
    // This does not work for dynamic library because the directory
    // where ocipkg download archive is not searched by ld
    // unless user set `LD_LIBRARY_PATH` explictly.
    if cfg.link == LinkType::Static {
        if cfg!(target_os = "linux") {
            let _ = ocipkg::link_package(&format!(
                "ghcr.io/rust-math/rust-mkl/linux/{}:2020.1-3038006115",
                MKL_CONFIG
            ));
        }
        if cfg!(target_os = "windows") {
            let _ = ocipkg::link_package(&format!(
                "ghcr.io/rust-math/rust-mkl/windows/{}:2022.0-3038006115",
                MKL_CONFIG
            ));
        }
    }

    Ok(())
}
