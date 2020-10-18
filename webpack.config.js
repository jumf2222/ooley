const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = {
    entry: { index: "./src/index.ts", room: "./src/room.ts" },
    plugins: [
        new CleanWebpackPlugin({
            cleanStaleWebpackAssets: false,
        }),
        new HtmlWebpackPlugin({
            filename: "index.html",
            chunks: ["index"],
            template: "src/index.html",
        }),
        new HtmlWebpackPlugin({
            filename: "room.html",
            chunks: ["room"],
            template: "src/room.html",
        }),
    ],
    devtool: "source-map",
    devServer: {
        contentBase: "./docs",
        // hot: true,
        compress: true,
        port: 25565,
        // open: true,
    },
    output: {
        filename: "[name].bundle.js",
        path: path.resolve(__dirname, "docs"),
        devtoolModuleFilenameTemplate: "[absolute-resource-path]",
        chunkFilename: "[id].bundle_[chunkhash].js",
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js"],
    },
    module: {
        rules: [
            { test: /\.tsx?$/, loader: "ts-loader" },
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"],
            },
        ],
    },
};
