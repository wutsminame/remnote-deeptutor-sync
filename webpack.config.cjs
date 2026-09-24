const path = require('path');
const Html = require('html-webpack-plugin');
const Copy = require('copy-webpack-plugin');
const { BannerPlugin } = require('webpack');
module.exports = {
  entry: {index:'./src/widgets/index.tsx', 'index-sandbox':'./src/widgets/index.tsx',
          settings:'./src/widgets/settings.tsx', 'settings-sandbox':'./src/widgets/settings.tsx'},
  output: {path:path.resolve(__dirname,'dist'),filename:'[name].js',publicPath:'',clean:true},
  resolve: {extensions:['.tsx','.ts','.js']},
  module:{rules:[{test:/\.[jt]sx?$/,loader:'esbuild-loader',options:{loader:'tsx',target:'es2022'}}]},
  plugins:[
    new BannerPlugin({raw:true,banner:({chunk})=>chunk.name.endsWith('-sandbox')?'':'const IMPORT_META=import.meta;'}),
    new Html({inject:false,templateContent:`<html><body><script>
      const w = new URLSearchParams(location.search).get('widgetName');
      if (['index','settings'].includes(w)) { const s=document.createElement('script');s.type='module';s.src=w+'-sandbox.js';document.body.appendChild(s); }
      else document.body.textContent='RemNote DeepTutor Sync: install this URL in RemNote.';
    </script></body></html>`}),
    new Copy({patterns:[{from:'public'},{from:'README.md'}]})
  ],
  devServer:{host:'127.0.0.1',port:8080,allowedHosts:'auto',headers:{'Access-Control-Allow-Origin':'*'},hot:false},
  devtool:false
};
