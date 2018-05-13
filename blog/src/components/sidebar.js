import React from 'react'
import './sidebar.css'

const tex = '\\frac{d}{dx} \sin (x) = 2 \cos (x)'

const Sidebar = (props) => (
<div
    style={{
      border: '2px solid #e6e6e6',
      maxWidth: 960,
      padding: '0.5rem',
      marginBottom: '25px',
      textAlign : 'right',
      direction : 'rtl',
    }}
    >
    <p> <script src='https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.4/MathJax.js?config=TeX-MML-AM_CHTML'></script>
    <strong>{props.title} - </strong> {props.description}
    </p>


</div>
);

export default Sidebar;